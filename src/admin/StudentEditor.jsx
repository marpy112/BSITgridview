import { useEffect, useRef, useState } from 'react';
import { yearLabels } from '../data.js';
import { normalizeSchoolAcronym } from '../../shared/transfer.js';

export default function StudentEditor({ student, onSave, onClose }) {
  const ref = useRef(null);
  const [id,setId] = useState('');
  const [firstName,setFirstName] = useState('');
  const [middleName,setMiddleName] = useState('');
  const [lastName,setLastName] = useState('');
  const [year,setYear] = useState(String(student?.year || 1));
  const [studentStatus,setStudentStatus] = useState(student?.studentStatus || 'Active');
  const [email,setEmail] = useState(student?.email || '');
  const [isTransferee, setIsTransferee] = useState(Boolean(student?.isTransferee));
  const [previousSchool, setPreviousSchool] = useState(student?.previousSchool || '');
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState('');
  useEffect(() => { const dialog=ref.current; dialog.showModal(); return () => dialog.close(); },[]);
  async function submit(event) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      await onSave({ ...(student ? {} : { id:id.trim(),firstName:firstName.trim(),middleName:middleName.trim(),lastName:lastName.trim() }),year:Number(year),studentStatus,email:email.trim(),isTransferee,previousSchool:isTransferee ? normalizeSchoolAcronym(previousSchool) : '' });
      onClose();
    } catch(error) { setError(error.message); }
    finally { setSaving(false); }
  }
  return <dialog ref={ref} className="record-editor student-editor" aria-labelledby="student-editor-title" onCancel={event => { event.preventDefault(); if(!saving) onClose(); }}>
    <button className="close icon-button" disabled={saving} onClick={onClose} aria-label="Close student form">×</button>
    <div className="eyebrow">STUDENT MANAGEMENT</div><h2 id="student-editor-title">{student ? 'Edit student details' : 'Add a student'}</h2>
    {student && <p>{student.name} · {student.id}</p>}
    <form onSubmit={submit}>
      {!student && <><label htmlFor="student-id">Student ID / username</label><input id="student-id" required minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9-]{2,31}" value={id} onChange={event => setId(event.target.value)} placeholder="Enter the student ID" />
      <label htmlFor="student-first-name">First name</label><input id="student-first-name" required maxLength={80} value={firstName} onChange={event => setFirstName(event.target.value)} />
      <label htmlFor="student-middle-name">Middle name <span>(optional)</span></label><input id="student-middle-name" maxLength={80} value={middleName} onChange={event => setMiddleName(event.target.value)} />
      <label htmlFor="student-last-name">Last name</label><input id="student-last-name" required maxLength={80} value={lastName} onChange={event => setLastName(event.target.value)} /></>}
      <div className="admin-form-columns"><div><label htmlFor="student-year">Year level</label><select id="student-year" value={year} onChange={event => setYear(event.target.value)}>{Object.entries(yearLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <div><label htmlFor="student-status">Student status</label><select id="student-status" value={studentStatus} onChange={event => setStudentStatus(event.target.value)}>{['Active','Inactive','Graduated'].map(status => <option key={status}>{status}</option>)}</select></div></div>
      <label htmlFor="student-email">Email <span>(optional)</span></label><input id="student-email" type="email" maxLength={160} value={email} onChange={event => setEmail(event.target.value)} />
      <label htmlFor="student-type">Student type</label><select id="student-type" value={isTransferee ? 'transferee' : 'regular'} onChange={event => setIsTransferee(event.target.value === 'transferee')}><option value="regular">Regular student</option><option value="transferee">Transferee</option></select>
      {isTransferee && <><label htmlFor="student-previous-school">Previous school acronym</label><input id="student-previous-school" required maxLength={30} value={previousSchool} onChange={event => setPreviousSchool(event.target.value.toUpperCase())} placeholder="e.g. PUP, TUP, or SSC-R" /><p className="prototype-note">Use this school as the default for transferred grades. Each course can have its own school acronym; current-school grades stay unmarked.</p></>}
      <p className="prototype-note">{student ? 'Existing grades and the student’s password will be kept. Student status describes their enrollment; it does not delete records or block access to their progress.' : 'The student ID becomes the username and the exact last name becomes the initial password. A personal password is required at first login. All 68 curriculum courses are added with blank grades.'}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="editor-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={saving} aria-busy={saving}>{saving ? 'Saving…' : student ? 'Save student' : 'Create student account'}</button></div>
    </form>
  </dialog>;
}
