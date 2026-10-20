import { useEffect, useRef, useState } from 'react';
import './admin-tools.css';

export default function ResetStudentPasswordDialog({ student, onReset, onClose }) {
  const ref = useRef(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  async function reset(event) {
    event.preventDefault(); setSaving(true); setError('');
    try { await onReset(student.id); onClose(); }
    catch (error) { setError(error.message); }
    finally { setSaving(false); }
  }
  return <dialog ref={ref} className="record-editor" aria-labelledby="reset-password-title" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
    <button className="close icon-button" aria-label="Close password reset" disabled={saving} onClick={onClose}>×</button>
    <div className="eyebrow">STUDENT ACCOUNT</div><h2 id="reset-password-title">Reset student password?</h2>
    <p className="admin-tool-description">This will replace the student’s current password with their exact saved last name.</p>
    <div className="password-reset-summary"><strong>{student.name}</strong><span>Student ID: {student.id}</span><span>Default password (case-sensitive)</span><code>{student.lastName || 'No saved last name'}</code></div>
    <p className="admin-tool-description">Their existing sessions will be signed out. At their next login, they must choose a new password before viewing records. Grades and student details are kept.</p>
    <form onSubmit={reset}>{error && <p className="form-error" role="alert">{error}</p>}<div className="editor-actions"><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={saving || !student.lastName?.trim()}>{saving ? 'Resetting…' : 'Reset to last name'}</button></div></form>
  </dialog>;
}
