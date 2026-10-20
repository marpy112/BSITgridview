import { useEffect, useRef, useState } from 'react';
import { academicYearLabel, defaultAcademicTerm } from '../../shared/academic.js';
import { termLabels } from '../data.js';
import GradeSelect from './GradeSelect.jsx';

export function validateRecord(grade,status){
  if(['Passed','Failed'].includes(status)&&grade==='')return 'Enter a final grade for a passed or failed record.';
  if(grade!==''&&(!Number.isFinite(Number(grade))||Number(grade)<1||Number(grade)>5))return 'Grade must be between 1.00 and 5.00.';
  if(status==='Passed'&&Number(grade)>3)return 'A passing grade must be 3.00 or better.';
  if(status==='Failed'&&Number(grade)<=3)return 'A failed grade must be above 3.00.';
  if(['Not taken','Incomplete','In progress'].includes(status)&&grade!=='')return 'Leave the final grade blank for courses not taken, incomplete, or ongoing.';
  return '';
}

export default function RecordEditor({ student,course,academicTerm=defaultAcademicTerm,onSave,onClose }){
  const ref=useRef(null);
  const [grade,setGrade]=useState(course.grade===null?'':String(course.grade));
  const [status,setStatus]=useState(course.status);
  const [instructor,setInstructor]=useState(course.instructor==='Unassigned'?'':course.instructor);
  const [schoolYear,setSchoolYear]=useState((course.academicYearTaken||academicYearLabel(academicTerm)).slice(0,4));
  const [semester,setSemester]=useState(course.semesterTaken||course.semester||academicTerm.semester);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{const dialog=ref.current;dialog.showModal();return()=>dialog.close();},[]);
  async function submit(event){event.preventDefault();const message=validateRecord(grade,status);if(message){setError(message);return;}setSaving(true);setError('');try{await onSave(student.id,course.code,{grade:grade===''?null:Number(grade),status,instructor:instructor.trim()||'Unassigned',academicYearTaken:status==='Not taken'?'':`${schoolYear}–${Number(schoolYear)+1}`,semesterTaken:status==='Not taken'?'':semester});onClose();}catch(error){setError(error.message);}finally{setSaving(false);}}
  function changeGrade(value){setGrade(value);setError('');if(value!=='')setStatus(Number(value)<=3?'Passed':'Failed');else if(['Passed','Failed'].includes(status))setStatus('In progress');}
  return <dialog ref={ref} className="record-editor" aria-labelledby="editor-title" onCancel={event=>{event.preventDefault();if(!saving)onClose();}}><button className="close icon-button" aria-label="Close editor" disabled={saving} onClick={onClose}>×</button><div className="eyebrow">{course.grade===null?'ADD A GRADE OR UPDATE STATUS':'EDIT STUDENT RECORD'}</div><h2 id="editor-title">{course.code} · {course.title}</h2><p>{student.name}</p><form onSubmit={submit}>
    <label htmlFor="record-grade">Final grade <span>(1.00–5.00)</span></label><GradeSelect id="record-grade" value={grade} onChange={event=>changeGrade(event.target.value)} />
    <label htmlFor="record-status">Course status</label><select id="record-status" value={status} onChange={event=>{const next=event.target.value;setStatus(next);if(['Not taken','Incomplete','In progress'].includes(next))setGrade('');setError('');}}>{['Not taken','Passed','In progress','Incomplete','Failed'].map(value=><option key={value}>{value}</option>)}</select>
    <label htmlFor="record-instructor">Instructor</label><input id="record-instructor" maxLength={120} value={instructor} onChange={event=>setInstructor(event.target.value)} placeholder="Unassigned"/>
    {status!=='Not taken'&&<div className="admin-form-columns"><div><label htmlFor="record-year-taken">School year starts</label><input id="record-year-taken" type="number" min="2000" max="2199" step="1" required value={schoolYear} onChange={event=>setSchoolYear(event.target.value)}/></div><div><label htmlFor="record-semester-taken">Term taken</label><select id="record-semester-taken" value={semester} onChange={event=>setSemester(event.target.value)}>{Object.entries(termLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div></div>}
    <p className="prototype-note">1.00 is highest; 3.00 is the passing limit. Entering a grade selects Passed or Failed automatically. Pending statuses have no final grade.</p>{error&&<p className="form-error" role="alert">{error}</p>}<div className="editor-actions"><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={saving} aria-busy={saving}>{saving?'Saving…':'Save record'}</button></div>
  </form></dialog>;
}
