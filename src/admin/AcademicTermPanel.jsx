import { useEffect, useRef, useState } from 'react';
import { academicTermLabel, nextAcademicTerm } from '../../shared/academic.js';

function TermDialog({ term, mode, onSave, onClose }) {
  const ref=useRef(null);
  const [year,setYear]=useState(String(term.schoolYearStart));
  const [semester,setSemester]=useState(term.semester);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [original]=useState(term);
  const next=nextAcademicTerm(original);
  useEffect(()=>{const dialog=ref.current;dialog.showModal();return()=>dialog.close();},[]);
  async function submit(event){event.preventDefault();setSaving(true);setError('');try{await onSave(mode==='advance'?{expectedVersion:original.version}:{schoolYearStart:Number(year),semester,expectedVersion:original.version},mode);onClose();}catch(error){setError(error.message);}finally{setSaving(false);}}
  return <dialog ref={ref} className="record-editor" aria-labelledby="term-dialog-title" onCancel={event=>{event.preventDefault();if(!saving)onClose();}}><button className="close icon-button" aria-label="Close term controls" disabled={saving} onClick={onClose}>×</button><div className="eyebrow">ACADEMIC CALENDAR</div><h2 id="term-dialog-title">{mode==='advance'?'Advance academic term':'Set current term'}</h2>
    <form onSubmit={submit}>{mode==='advance'?<div className="term-transition"><div><span>Current term</span><strong>{academicTermLabel(original)}</strong></div><span aria-hidden="true">↓</span><div><span>Next term</span><strong>{academicTermLabel(next)}</strong></div></div>:<><label htmlFor="academic-start-year">School year starts</label><input id="academic-start-year" type="number" min="2000" max="2199" step="1" required value={year} onChange={event=>setYear(event.target.value)}/><p className="prototype-note">School year: {year || '—'}–{year?Number(year)+1:'—'}</p><label htmlFor="academic-semester">Semester</label><select id="academic-semester" value={semester} onChange={event=>setSemester(event.target.value)}><option value="1">1st semester</option><option value="2">2nd semester</option></select></>}
    <p className="prototype-note">This changes the active term for the whole system. Existing grades and course records are kept. Student year levels stay as assigned; edit them separately when needed. Summer remains available in the curriculum filters.</p>{error&&<p className="form-error" role="alert">{error}</p>}<div className="editor-actions"><button type="button" className="secondary-button" disabled={saving} onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={saving} aria-busy={saving}>{saving?'Updating…':mode==='advance'?'Advance term':'Save active term'}</button></div></form>
  </dialog>;
}

export default function AcademicTermPanel({ term,onSave }){
  const [mode,setMode]=useState(null);
  const next=nextAcademicTerm(term);
  return <section className="academic-term-panel"><div><div className="eyebrow">ACTIVE SCHOOL YEAR & SEMESTER</div><h2>{academicTermLabel(term)}</h2><p>Next: {academicTermLabel(next)}</p></div><div className="academic-term-actions"><button className="secondary-button" onClick={()=>setMode('set')}>Set current term</button><button className="primary-button" onClick={()=>setMode('advance')}>{term.semester==='1'?'Advance to 2nd semester':'Start next school year'} <span aria-hidden="true">→</span></button></div>{mode&&<TermDialog term={term} mode={mode} onSave={onSave} onClose={()=>setMode(null)}/>}</section>;
}
