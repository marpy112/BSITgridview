export async function databaseReady(db) {
  // Compile the certificate query without reading recipient names or design artwork.
  await db.prepare(`SELECT c.student_no,c.batch_id,c.verification_token,b.request_fingerprint,t.pdf_base64
    FROM certificates c JOIN certificate_batches b ON b.id=c.batch_id
    JOIN certificate_templates t ON t.id=c.template_id LIMIT 0`).all();
  return Boolean(await db.prepare('SELECT version FROM academic_calendar WHERE id=1').first());
}
