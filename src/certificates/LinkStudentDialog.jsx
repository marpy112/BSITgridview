import { useEffect, useRef, useState } from 'react';

export default function LinkStudentDialog({ certificate, students, onSave, onClose }) {
  const ref = useRef(null);
  const matchingAccounts = students.filter(student => student.name.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase() === certificate.recipientName.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase());
  const [studentId, setStudentId] = useState(certificate.studentId || (matchingAccounts.length === 1 ? matchingAccounts[0].id : ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onSave(certificate, studentId); onClose(); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <dialog ref={ref} className="record-editor" aria-labelledby="certificate-link-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <button type="button" className="close icon-button" disabled={busy} onClick={onClose} aria-label="Close student link form">×</button>
    <div className="eyebrow">STUDENT CERTIFICATE ACCESS</div><h2 id="certificate-link-title">Link a student account</h2>
    <p>{certificate.recipientName}</p><p className="certificate-monospace">{certificate.id}</p>
    <form onSubmit={submit}><label htmlFor="certificate-link-student">Student account</label><select id="certificate-link-student" required autoFocus disabled={busy} value={studentId} onChange={event => setStudentId(event.target.value)}><option value="">Choose the recipient’s account</option>{students.map(student => <option key={student.id} value={student.id}>{student.name} · {student.id}</option>)}</select>
      <p className="certificate-disclosure">The selected student can view and download this certificate from their account. Confirm the recipient before saving. Changing the linked account removes access from the previous account.</p>
      {error && <p className="form-error" role="alert">{error}</p>}<div className="editor-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={busy || !studentId}>{busy ? 'Saving…' : 'Link student account'}</button></div>
    </form>
  </dialog>;
}
