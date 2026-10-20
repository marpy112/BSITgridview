import { useEffect, useRef, useState } from 'react';
import { nextRetakeTerm, retakeLabel } from '../../shared/retakes.js';

export default function RetakeDialog({ student, course, onStart, onClose }) {
  const ref = useRef(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const next = nextRetakeTerm(course.academicYearTaken, course.semesterTaken);
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  async function submit(event) {
    event.preventDefault(); setSaving(true); setError('');
    try { await onStart(course); onClose(); }
    catch (error) { setError(error.message); }
    finally { setSaving(false); }
  }
  return <dialog ref={ref} className="record-editor" aria-labelledby="retake-dialog-title" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
    <button className="close icon-button" aria-label="Close retake confirmation" disabled={saving} onClick={onClose}>×</button>
    <div className="eyebrow">COURSE RETAKE</div><h2 id="retake-dialog-title">Start a new attempt?</h2>
    <p className="admin-tool-description">{student.name} · {course.code}</p><div className="password-reset-summary"><strong>Failed grade: {course.grade?.toFixed(2)}</strong><span>{retakeLabel({ schoolYear: course.academicYearTaken, semester: course.semesterTaken })}</span><span>Retake school year and semester</span><strong>{retakeLabel(next)}</strong></div>
    <p className="admin-tool-description">The failed grade and its school details stay in the attempt history. The new attempt starts In progress with no final grade, so you can record its result separately.</p>
    <form onSubmit={submit}>{error && <p className="form-error" role="alert">{error}</p>}<div className="editor-actions"><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={saving || !next}>{saving ? 'Starting…' : 'Start retake'}</button></div></form>
  </dialog>;
}
