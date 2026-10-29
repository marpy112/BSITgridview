import { certificateIssuer, certificateVerificationUrl } from '../shared/certificates.js';

export async function studentCertificateSummary(db, studentNo) {
  const row = await db.prepare('SELECT COUNT(*) AS total,COUNT(CASE WHEN revoked_at IS NULL THEN 1 END) AS valid FROM certificates WHERE student_no=?').bind(studentNo).first();
  return { total: row.total, valid: row.valid };
}

function summary(row, origin) {
  return { id: row.id, token: row.verification_token, templateId: row.template_id, title: row.title,
    recipientName: row.recipient_name, issuedAt: row.issued_at, revokedAt: row.revoked_at,
    status: row.revoked_at ? 'revoked' : 'verified', issuer: certificateIssuer,
    verificationUrl: certificateVerificationUrl(origin, row.verification_token) };
}

export async function studentCertificates(request, db, user, json, origin = new URL(request.url).origin) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/my/certificates')) return null;
  if (user.role !== 'student' || !user.student_no) return json({ error: 'A student account is required.' }, 403);
  if (request.method !== 'GET') return json({ error: 'Certificate endpoint not found.' }, 404);
  if (url.pathname === '/api/my/certificates/summary') return json({ summary: await studentCertificateSummary(db, user.student_no) });
  if (url.pathname === '/api/my/certificates') {
    const rawPage = url.searchParams.get('page') || '1';
    if (!/^[1-9]\d{0,5}$/.test(rawPage)) return json({ error: 'Choose a valid page.' }, 400);
    const rows = await db.prepare(`SELECT c.*,t.title FROM certificates c JOIN certificate_templates t ON t.id=c.template_id
      WHERE c.student_no=? ORDER BY c.issued_at DESC,c.id LIMIT 26 OFFSET ?`).bind(user.student_no, (Number(rawPage) - 1) * 25).all();
    return json({ certificates: rows.results.slice(0, 25).map(row => summary(row, origin)), hasMore: rows.results.length > 25,
      summary: await studentCertificateSummary(db, user.student_no) });
  }
  const match = url.pathname.match(/^\/api\/my\/certificates\/(IBACMI-IT-\d{4}-[A-F0-9]{12})$/);
  if (match) {
    // Ownership always comes from the authenticated session, never a request parameter or a name match.
    const row = await db.prepare(`SELECT c.*,t.title,t.pdf_base64,t.page_width,t.page_height,t.layout_json FROM certificates c
      JOIN certificate_templates t ON t.id=c.template_id WHERE c.id=? AND c.student_no=?`).bind(match[1], user.student_no).first();
    if (!row) return json({ error: 'Certificate not found in your account.' }, 404);
    if (row.revoked_at) return json({ error: 'This certificate has been revoked and cannot be downloaded.' }, 410);
    return json({ certificate: summary(row, origin), template: { id: row.template_id, title: row.title,
      pdfBase64: row.pdf_base64, width: row.page_width, height: row.page_height, layout: JSON.parse(row.layout_json) } });
  }
  return json({ error: 'Certificate endpoint not found.' }, 404);
}
