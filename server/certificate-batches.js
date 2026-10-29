import { certificateIssuer, certificateVerificationUrl, maxBulkCertificateRecipients } from '../shared/certificates.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const validId = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);

function recipients(input) {
  if (!Array.isArray(input) || !input.length || input.length > maxBulkCertificateRecipients) fail(`Select 1–${maxBulkCertificateRecipients} recipients per batch.`);
  const seen = new Set();
  return input.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('Choose valid recipients.');
    let key, result;
    if (item.studentId !== undefined) {
      if (typeof item.studentId !== 'string' || !item.studentId.trim() || item.studentId.length > 150 || /[\u0000-\u001f\u007f]/.test(item.studentId) || item.recipientName !== undefined) fail('Choose a valid student.');
      key = `student:${item.studentId}`;
      result = { studentId: item.studentId, key };
    } else {
      if (typeof item.recipientName !== 'string' || /[\u0000-\u001f\u007f]/.test(item.recipientName)) fail('Enter valid recipient names.');
      const name = item.recipientName.normalize('NFC').replace(/\s+/g, ' ').trim();
      if (!name || name.length > 180) fail('Recipient names must be 1–180 characters.');
      key = `name:${name.toLowerCase()}`;
      result = { recipientName: name, key };
    }
    if (seen.has(key)) fail('Each recipient can appear only once in a batch. Remove duplicate selections or names.');
    seen.add(key);
    return result;
  });
}

async function fingerprint(templateId, selection) {
  const bytes = new TextEncoder().encode(JSON.stringify([templateId, selection.map(item => item.key).sort()]));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function savedBatch(db, id, user, expectedFingerprint, origin, json) {
  const batch = await db.prepare('SELECT * FROM certificate_batches WHERE id=?').bind(id).first();
  if (!batch) return null;
  if (batch.issued_by !== user.id || batch.request_fingerprint !== expectedFingerprint) fail('This batch request belongs to a different selection. Start a new batch.', 409);
  const rows = await db.prepare(`SELECT c.*,t.title FROM certificates c JOIN certificate_templates t ON t.id=c.template_id
    WHERE c.batch_id=? ORDER BY c.rowid`).bind(id).all();
  return json({ batchId: id, certificates: rows.results.map(row => ({
    id: row.id, token: row.verification_token, templateId: row.template_id, title: row.title,
    studentId: row.student_no || null,
    recipientName: row.recipient_name, issuedAt: row.issued_at, revokedAt: row.revoked_at,
    status: row.revoked_at ? 'revoked' : 'verified', issuer: certificateIssuer,
    verificationUrl: certificateVerificationUrl(origin, row.verification_token),
  })) });
}

export async function issueCertificateBatch(request, db, user, { body, json, origin = new URL(request.url).origin }) {
  if (user.role !== 'admin') return json({ error: 'Administrator access is required.' }, 403);
  const input = await body(request, 196608);
  if (!validId(input.requestId)) fail('Start a new certificate batch and try again.');
  if (!validId(input.templateId)) fail('Select a saved certificate design.');
  const selection = recipients(input.recipients);
  const requestFingerprint = await fingerprint(input.templateId, selection);
  const existing = await savedBatch(db, input.requestId, user, requestFingerprint, origin, json);
  if (existing) return existing;

  const template = await db.prepare('SELECT id,title FROM certificate_templates WHERE id=?').bind(input.templateId).first();
  if (!template) return json({ error: 'Certificate design not found.' }, 404);
  const studentIds = selection.filter(item => item.studentId !== undefined).map(item => item.studentId);
  const names = new Map();
  for (let start = 0; start < studentIds.length; start += 100) {
    const ids = studentIds.slice(start, start + 100);
    const rows = await db.prepare(`SELECT student_no,name FROM students WHERE student_no IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
    for (const student of rows.results) names.set(student.student_no, student.name);
  }
  const resolvedRecipients = selection.map(item => {
    const name = item.studentId === undefined ? item.recipientName : names.get(item.studentId);
    if (!name) fail('One or more selected students no longer exist. Refresh the student list.');
    if (name.length > 180 || /[\u0000-\u001f\u007f]/.test(name)) fail('One or more selected student names cannot fit a certificate. Update their profile before issuing.');
    return { name, studentId: item.studentId || null };
  });

  // Each recipient gets independently generated identifiers. The database also enforces
  // uniqueness across single issuance, other batches, and concurrent requests.
  for (let attempt = 0; attempt < 3; attempt++) {
    const issuedAt = new Date().toISOString();
    const ids = new Set(), tokens = new Set();
    const certificates = resolvedRecipients.map(({ name: recipientName, studentId }) => {
      let id, token;
      do { id = `IBACMI-IT-${issuedAt.slice(0, 4)}-${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`; } while (ids.has(id));
      do { token = crypto.randomUUID().replaceAll('-', ''); } while (tokens.has(token));
      ids.add(id); tokens.add(token);
      return { id, token, templateId: template.id, title: template.title, recipientName, issuedAt, studentId,
        revokedAt: null, status: 'verified', issuer: certificateIssuer, verificationUrl: certificateVerificationUrl(origin, token) };
    });
    const statements = [db.prepare('INSERT INTO certificate_batches(id,template_id,issued_by,issued_at,request_fingerprint) VALUES(?,?,?,?,?)')
      .bind(input.requestId, template.id, user.id, issuedAt, requestFingerprint)];
    // 12 rows × 8 fields = 96 bindings. Even a 200-person batch fits the gateway's
    // 20-statement limit, and the entire issuance commits or rolls back together.
    for (let start = 0; start < certificates.length; start += 12) {
      const chunk = certificates.slice(start, start + 12);
      statements.push(db.prepare(`INSERT INTO certificates(id,verification_token,template_id,recipient_name,issued_by,issued_at,batch_id,student_no)
        VALUES ${chunk.map(() => '(?,?,?,?,?,?,?,?)').join(',')}`).bind(...chunk.flatMap(item => [item.id, item.token, template.id, item.recipientName, user.id, issuedAt, input.requestId, item.studentId])));
    }
    statements.push(db.prepare('INSERT INTO admin_events(id,actor_id,action,title,detail) VALUES(?,?,?,?,?)')
      .bind(crypto.randomUUID(), user.id, 'certificate.batch.issued', `${certificates.length} certificates issued`, `${template.title} · Batch ${input.requestId}`));
    try {
      await db.batch(statements);
      return json({ batchId: input.requestId, certificates }, 201);
    } catch (error) {
      if (!/unique constraint/i.test(error.message || '')) throw error;
      // A simultaneous retry of the same request recovers the committed batch.
      const recovered = await savedBatch(db, input.requestId, user, requestFingerprint, origin, json);
      if (recovered) return recovered;
      if (attempt === 2) fail('Unique certificate identifiers could not be allocated. Please try again.', 503);
    }
  }
}
