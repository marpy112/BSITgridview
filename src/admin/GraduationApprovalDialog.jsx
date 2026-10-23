import { useEffect, useRef, useState } from 'react';
import { graduationState } from '../GraduationNotice.jsx';

export default function GraduationApprovalDialog({ student, onApprove, onClose }) {
  const ref = useRef(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const progress = graduationState(student);
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  async function approve(event) {
    event.preventDefault(); setSaving(true); setError('');
    try { await onApprove(student.id); onClose(); }
    catch (error) { setError(error.message); }
    finally { setSaving(false); }
  }
  return <dialog ref={ref} className="record-editor" aria-labelledby="graduation-approval-title" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
    <button className="close icon-button" disabled={saving} onClick={onClose} aria-label="Close graduation approval">×</button>
    <div className="eyebrow">GRADUATION REVIEW</div><h2 id="graduation-approval-title">Approve graduation?</h2>
    <div className="graduation-review-summary"><strong>{student.name}</strong><span>Student ID: {student.id}</span><b>{progress.completed} of {progress.required} required courses passed</b><span>Current status: {student.studentStatus || 'Active'}</span></div>
    <p className="admin-tool-description">Approving will change this student’s status to Graduated and record your approval. All required courses must have saved passing grades.</p>
    <form onSubmit={approve}>{error && <p className="form-error" role="alert">{error}</p>}<div className="editor-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="primary-button" disabled={saving || !progress.eligible} aria-busy={saving}>{saving ? 'Approving…' : 'Approve and mark Graduated'}</button></div></form>
  </dialog>;
}
