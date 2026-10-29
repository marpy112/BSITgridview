import { PDFDocument } from 'pdf-lib';
import { certificateIssuer, certificateVerificationUrl, certificatePageSize, maxCertificateJpegBytes, validCertificateLayout } from '../shared/certificates.js';
import { issueCertificateBatch } from './certificate-batches.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
function text(value, label) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) fail(`Enter a valid ${label}.`);
  const result = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!result || result.length > 180) fail(`Enter a ${label} of 1–180 characters.`);
  return result;
}
const templateSummary = row => ({ id: row.id, title: row.title, width: row.page_width, height: row.page_height, layout: JSON.parse(row.layout_json), createdAt: row.created_at });
const certificateSummary = (row, origin) => ({ id: row.id, token: row.verification_token, templateId: row.template_id,
  studentId: row.student_no || null,
  title: row.title, recipientName: row.recipient_name, issuedAt: row.issued_at, revokedAt: row.revoked_at,
  status: row.revoked_at ? 'revoked' : 'verified', issuer: certificateIssuer,
  verificationUrl: certificateVerificationUrl(origin, row.verification_token) });

export async function publicCertificate(request, db, json) {
  const match = new URL(request.url).pathname.match(/^\/api\/certificates\/verify\/([a-f0-9]{32})$/);
  if (!match || request.method !== 'GET') return null;
  const row = await db.prepare(`SELECT c.id,c.recipient_name,c.issued_at,c.revoked_at,t.title
    FROM certificates c JOIN certificate_templates t ON t.id=c.template_id WHERE c.verification_token=?`).bind(match[1]).first();
  if (!row) return json({ error: 'Certificate not found. Check the certificate link or contact the issuing department.' }, 404);
  // Verification deliberately excludes account identifiers, template designs and student records.
  return json({ certificate: { id: row.id, recipientName: row.recipient_name, title: row.title,
    issuedAt: row.issued_at, revokedAt: row.revoked_at, status: row.revoked_at ? 'revoked' : 'verified', issuer: certificateIssuer } });
}

export async function adminCertificates(request, env, user, { json, body }) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/certificate-templates') && !path.startsWith('/api/certificates')) return null;
  if (user.role !== 'admin') return json({ error: 'Administrator access is required.' }, 403);
  const db = env.DB;
  const origin = env.CERTIFICATE_ORIGIN || new URL(request.url).origin;
  if (path === '/api/certificates/bulk' && request.method === 'POST') return issueCertificateBatch(request, db, user, { json, body, origin });
  if (path === '/api/certificate-templates' && request.method === 'GET') {
    const rows = await db.prepare('SELECT id,title,page_width,page_height,layout_json,created_at FROM certificate_templates ORDER BY created_at DESC,id').all();
    return json({ templates: rows.results.map(templateSummary) });
  }
  if (path === '/api/certificate-templates' && request.method === 'POST') {
    const input = await body(request, 1450000);
    const title = text(input.title, 'certificate title');
    let width, height, pdfBase64;
    if (input.sourceTemplateId !== undefined) {
      if (typeof input.sourceTemplateId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.sourceTemplateId) || input.jpegBase64 !== undefined) fail('Choose one saved design to customize.');
      const source = await db.prepare('SELECT pdf_base64,page_width,page_height FROM certificate_templates WHERE id=?').bind(input.sourceTemplateId).first();
      if (!source) return json({ error: 'Certificate design not found.' }, 404);
      width = source.page_width; height = source.page_height; pdfBase64 = source.pdf_base64;
    } else {
      if (typeof input.jpegBase64 !== 'string' || input.jpegBase64.length > 1400000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.jpegBase64)) fail('Upload a JPEG (.jpg or .jpeg) design of up to 1 MB.');
      const clean = await PDFDocument.create();
      let artwork;
      try {
        const binary = atob(input.jpegBase64);
        if (binary.length > maxCertificateJpegBytes || binary.charCodeAt(0) !== 255 || binary.charCodeAt(1) !== 216 || !binary.endsWith('\xff\xd9')) throw new Error();
        artwork = await clean.embedJpg(Uint8Array.from(binary, character => character.charCodeAt(0)));
      } catch { fail('Use a valid JPEG (.jpg or .jpeg) image of up to 1 MB.'); }
      let dimensions;
      try { dimensions = certificatePageSize(artwork.width, artwork.height); }
      catch (error) { fail(error.message); }
      width = dimensions.width; height = dimensions.height;
      // Keep the stored PDF format compatible with existing certificate downloads.
      clean.addPage([width, height]).drawImage(artwork, { x: 0, y: 0, width, height });
      pdfBase64 = await clean.saveAsBase64();
      if (pdfBase64.length > 1400000) fail('The design is too large. Export a smaller JPEG, up to 1 MB.');
    }
    if (!validCertificateLayout(input.layout, width, height)) fail('Keep the name, ID and QR code inside the certificate page.');
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.batch([
      db.prepare('INSERT INTO certificate_templates(id,title,pdf_base64,page_width,page_height,layout_json,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)')
        .bind(id, title, pdfBase64, width, height, JSON.stringify(input.layout), user.id, now),
      db.prepare('INSERT INTO admin_events(id,actor_id,action,title,detail) VALUES(?,?,?,?,?)')
        .bind(crypto.randomUUID(), user.id, 'certificate.template.created', `Certificate design added: ${title}`, input.sourceTemplateId ? 'Customized placement saved as a new design.' : 'Ready to issue e-certificates.'),
    ]);
    return json({ template: { id, title, width, height, layout: input.layout, createdAt: now, pdfBase64 } }, 201);
  }
  const templateMatch = path.match(/^\/api\/certificate-templates\/([a-f0-9-]{36})$/);
  if (templateMatch && request.method === 'GET') {
    const row = await db.prepare('SELECT * FROM certificate_templates WHERE id=?').bind(templateMatch[1]).first();
    return row ? json({ template: { ...templateSummary(row), pdfBase64: row.pdf_base64 } }) : json({ error: 'Certificate design not found.' }, 404);
  }
  if (path === '/api/certificates' && request.method === 'GET') {
    const url = new URL(request.url);
    const rawPage = url.searchParams.get('page') || '1';
    if (!/^[1-9]\d{0,5}$/.test(rawPage)) fail('Choose a valid page.');
    const page = Number(rawPage);
    const rows = await db.prepare(`SELECT c.*,t.title FROM certificates c JOIN certificate_templates t ON t.id=c.template_id
      ORDER BY c.issued_at DESC,c.id LIMIT 26 OFFSET ?`).bind((page - 1) * 25).all();
    return json({ certificates: rows.results.slice(0, 25).map(row => certificateSummary(row, origin)), hasMore: rows.results.length > 25 });
  }
  if (path === '/api/certificates' && request.method === 'POST') {
    const input = await body(request);
    let studentNo = null, recipientName;
    if (input.studentId !== undefined) {
      if (typeof input.studentId !== 'string' || !input.studentId || input.studentId.length > 150 || input.recipientName !== undefined) fail('Select a student account or enter another recipient name.');
      const student = await db.prepare('SELECT student_no,name FROM students WHERE student_no=?').bind(input.studentId).first();
      if (!student) return json({ error: 'Student account not found.' }, 404);
      studentNo = student.student_no; recipientName = text(student.name, 'recipient name');
    } else recipientName = text(input.recipientName, 'recipient name');
    if (typeof input.templateId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.templateId)) fail('Select a saved certificate design.');
    const template = await db.prepare('SELECT id,title FROM certificate_templates WHERE id=?').bind(input.templateId).first();
    if (!template) return json({ error: 'Certificate design not found.' }, 404);
    const issuedAt = new Date().toISOString();
    const id = `IBACMI-IT-${issuedAt.slice(0, 4)}-${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
    const token = crypto.randomUUID().replaceAll('-', '');
    await db.batch([
      db.prepare('INSERT INTO certificates(id,verification_token,template_id,recipient_name,issued_by,issued_at,student_no) VALUES(?,?,?,?,?,?,?)')
        .bind(id, token, template.id, recipientName, user.id, issuedAt, studentNo),
      db.prepare('INSERT INTO admin_events(id,actor_id,action,title,detail) VALUES(?,?,?,?,?)')
        .bind(crypto.randomUUID(), user.id, 'certificate.issued', `Certificate issued to ${recipientName}`, `${template.title} · ${id}`),
    ]);
    return json({ certificate: { id, token, templateId: template.id, title: template.title, recipientName, studentId: studentNo,
      issuedAt, revokedAt: null, status: 'verified', issuer: certificateIssuer,
      verificationUrl: certificateVerificationUrl(origin, token) } }, 201);
  }
  const studentMatch = path.match(/^\/api\/certificates\/(IBACMI-IT-\d{4}-[A-F0-9]{12})\/student$/);
  if (studentMatch && request.method === 'PATCH') {
    const input = await body(request);
    if (typeof input.studentId !== 'string' || !input.studentId || input.studentId.length > 150) fail('Select the student account for this certificate.');
    const row = await db.prepare('SELECT id,student_no,recipient_name FROM certificates WHERE id=?').bind(studentMatch[1]).first();
    if (!row) return json({ error: 'Certificate not found.' }, 404);
    if (input.expectedStudentId !== row.student_no) return json({ error: 'This certificate account link changed. Refresh and try again.' }, 409);
    const student = await db.prepare('SELECT student_no,name FROM students WHERE student_no=?').bind(input.studentId).first();
    if (!student) return json({ error: 'Student account not found.' }, 404);
    if (row.student_no === student.student_no) return json({ ok: true });
    const operationId = crypto.randomUUID();
    const results = await db.batch([
      db.prepare('UPDATE certificates SET student_no=? WHERE id=? AND student_no IS ?').bind(student.student_no, row.id, row.student_no),
      db.prepare('INSERT INTO admin_events(id,actor_id,action,title,detail) SELECT ?,?,?,?,? WHERE changes()=1')
        .bind(operationId, user.id, 'certificate.student.linked', `Certificate linked: ${row.id}`, `${row.recipient_name} → ${student.student_no} · ${student.name}`),
    ]);
    if (results[0].meta.changes !== 1) return json({ error: 'This certificate account link changed. Refresh and try again.' }, 409);
    return json({ ok: true });
  }
  const revokeMatch = path.match(/^\/api\/certificates\/(IBACMI-IT-\d{4}-[A-F0-9]{12})\/revoke$/);
  if (revokeMatch && request.method === 'POST') {
    const row = await db.prepare('SELECT * FROM certificates WHERE id=?').bind(revokeMatch[1]).first();
    if (!row) return json({ error: 'Certificate not found.' }, 404);
    const now = new Date().toISOString();
    await db.batch([
      db.prepare('UPDATE certificates SET revoked_at=?,revoked_by=? WHERE id=? AND revoked_at IS NULL').bind(now, user.id, row.id),
      db.prepare(`INSERT INTO admin_events(id,actor_id,action,title,detail) SELECT ?,?,?,?,? WHERE EXISTS
        (SELECT 1 FROM certificates WHERE id=? AND revoked_at=?)`).bind(crypto.randomUUID(), user.id, 'certificate.revoked', `Certificate revoked: ${row.id}`, row.recipient_name, row.id, now),
    ]);
    return json({ ok: true });
  }
  return json({ error: 'Certificate endpoint not found.' }, 404);
}
