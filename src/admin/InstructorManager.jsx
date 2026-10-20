import { useEffect, useRef, useState } from 'react';
import './admin-tools.css';

export function InstructorDialog({ onSave, onClose }) {
  const ref = useRef(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
  async function submit(event) {
    event.preventDefault(); setSaving(true); setError('');
    try { await onSave({ name }); onClose(); }
    catch (error) { setError(error.message); }
    finally { setSaving(false); }
  }
  return <dialog ref={ref} className="record-editor" aria-labelledby="instructor-dialog-title" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
    <button className="close icon-button" aria-label="Close instructor form" disabled={saving} onClick={onClose}>×</button>
    <div className="eyebrow">INSTRUCTOR DIRECTORY</div><h2 id="instructor-dialog-title">Add an instructor</h2>
    <p className="admin-tool-description">Save a name once, then select it from any course’s instructor dropdown.</p>
    <form onSubmit={submit}>
      <label htmlFor="instructor-name">Full name</label><input id="instructor-name" autoFocus required maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Prof. Maria Santos" disabled={saving} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="editor-actions"><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={saving || !name.trim()}>{saving ? 'Adding…' : 'Add instructor'}</button></div>
    </form>
  </dialog>;
}

export default function InstructorManager({ instructors, students, onAdd }) {
  const [query, setQuery] = useState('');
  const filtered = instructors.filter(item => item.name.toLowerCase().includes(query.trim().toLowerCase()));
  const assignments = new Map();
  for (const student of students) for (const course of student.courses) assignments.set(course.instructor, (assignments.get(course.instructor) || 0) + 1);
  return <section className="admin-panel instructor-directory">
    <div className="admin-section-heading"><div><h2>Instructor directory <span className="count-pill">{instructors.length}</span></h2><p>Names available when assigning instructors to student course records.</p></div><button className="primary-button" onClick={onAdd}>+ Add instructor</button></div>
    <label className="admin-search instructor-search"><span aria-hidden="true">⌕</span><input aria-label="Search instructors" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search instructor name" /></label>
    <div className="instructor-list">{filtered.length ? filtered.map(item => <article className="instructor-list-row" key={item.id}>
      <span className="avatar" aria-hidden="true">{item.name.split(' ').map(part => part[0]).join('').slice(0, 2)}</span><strong>{item.name}</strong><span>{assignments.get(item.name) || 0} course records</span>
    </article>) : <div className="empty"><strong>{query ? 'No matching instructors' : 'Add your first instructor'}</strong><p>{query ? 'Try another name.' : 'Add an instructor to make their name available in the grade table.'}</p></div>}</div>
    <div className="directory-footer">Showing {filtered.length} of {instructors.length} instructors</div>
  </section>;
}
