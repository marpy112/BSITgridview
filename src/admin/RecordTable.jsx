import { Fragment, useEffect, useId, useState } from 'react';
import { academicYearLabel } from '../../shared/academic.js';
import { termLabels } from '../data.js';
import { validateRecord } from './RecordEditor.jsx';
import './record-table.css';

const statuses = ['Not taken', 'In progress', 'Incomplete', 'Passed', 'Failed'];

function fields(course, academicTerm) {
  return {
    grade: course.grade === null ? '' : course.grade.toFixed(2),
    status: course.status,
    instructor: course.instructor === 'Unassigned' ? '' : course.instructor,
    schoolYear: (course.academicYearTaken || academicYearLabel(academicTerm)).slice(0, 4),
    semester: course.semesterTaken || course.semester || academicTerm.semester,
  };
}

function payload(draft) {
  return {
    grade: draft.grade === '' ? null : Number(draft.grade),
    status: draft.status,
    instructor: draft.instructor.trim() || 'Unassigned',
    academicYearTaken: draft.status === 'Not taken' ? '' : `${draft.schoolYear}–${Number(draft.schoolYear) + 1}`,
    semesterTaken: draft.status === 'Not taken' ? '' : draft.semester,
  };
}

function validation(draft) {
  const message = validateRecord(draft.grade, draft.status);
  if (message) return message;
  const grade = Number(draft.grade);
  if (draft.grade !== '' && Math.abs(grade * 100 - Math.round(grade * 100)) > 0.00001) return 'Use no more than two decimal places for the grade.';
  if (draft.instructor.trim().length > 120) return 'Instructor must be 120 characters or fewer.';
  if (draft.status !== 'Not taken' && (!/^\d{4}$/.test(draft.schoolYear) || Number(draft.schoolYear) < 2000 || Number(draft.schoolYear) > 2199)) return 'Enter a school year starting between 2000 and 2199.';
  return '';
}

export default function RecordTable({ student, visibleCourses, academicTerm, instructors, onAddInstructor, onSave, onDirtyChange, onBusyChange }) {
  const [drafts, setDrafts] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState({});
  const [notice, setNotice] = useState('');
  const errorPrefix = useId();
  const dirtyCourses = student.courses.filter(course => drafts[course.code] &&
    JSON.stringify(payload(drafts[course.code])) !== JSON.stringify(payload(fields(course, academicTerm))));
  const dirtyCodes = new Set(dirtyCourses.map(course => course.code));
  const hiddenChanges = dirtyCourses.filter(course => !visibleCourses.some(item => item.code === course.code)).length;

  useEffect(() => { onDirtyChange(dirtyCourses.length > 0); }, [dirtyCourses.length, onDirtyChange]);
  useEffect(() => { onBusyChange(saving); }, [saving, onBusyChange]);
  useEffect(() => () => { onDirtyChange(false); onBusyChange(false); }, [onDirtyChange, onBusyChange]);
  useEffect(() => {
    if (!dirtyCourses.length) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirtyCourses.length]);

  function edit(course, changes) {
    setDrafts(current => ({ ...current, [course.code]: { ...(current[course.code] || fields(course, academicTerm)), ...changes } }));
    setErrors(current => ({ ...current, [course.code]: '' }));
    setSaved(current => ({ ...current, [course.code]: false }));
    setNotice('');
  }

  function changeGrade(course, value) {
    const current = drafts[course.code] || fields(course, academicTerm);
    const next = { grade: value };
    if (value !== '' && Number(value) >= 1 && Number(value) <= 5) next.status = Number(value) <= 3 ? 'Passed' : 'Failed';
    else if (value === '' && ['Passed', 'Failed'].includes(current.status)) next.status = 'In progress';
    edit(course, next);
  }

  async function saveCourses(items) {
    if (saving || !items.length) return;
    const invalid = Object.fromEntries(items.map(course => [course.code, validation(drafts[course.code])]).filter(([, message]) => message));
    if (Object.keys(invalid).length) {
      setErrors(current => ({ ...current, ...invalid }));
      setNotice('Check the highlighted rows before saving.');
      return;
    }
    setSaving(true);
    setNotice('');
    let count = 0;
    for (const course of items) {
      try {
        await onSave(student.id, course.code, payload(drafts[course.code]));
        setDrafts(current => { const next = { ...current }; delete next[course.code]; return next; });
        setErrors(current => ({ ...current, [course.code]: '' }));
        setSaved(current => ({ ...current, [course.code]: true }));
        count++;
      } catch (error) {
        setErrors(current => ({ ...current, [course.code]: error.message || 'Could not save this record. Try again.' }));
      }
    }
    setSaving(false);
    setNotice(count === items.length ? `${count} ${count === 1 ? 'record' : 'records'} saved.` : `${count} of ${items.length} records saved. Unsaved changes are kept; review the highlighted rows.`);
  }

  function discard() {
    setDrafts({}); setErrors({}); setSaved({}); setNotice('Changes discarded.');
  }

  return <section className="record-sheet" aria-label="Edit student course records" aria-busy={saving}>
    <div className="record-sheet-heading">
      <div><h3>Course grades <span>{visibleCourses.length} courses</span></h3><p>Enter grades directly. Passing and failing statuses are selected for you.</p></div>
      <div className="record-sheet-heading-actions"><span className="record-sheet-scale">1.00 highest <span>·</span> 3.00 passing limit</span><button type="button" className="secondary-button" disabled={saving} onClick={onAddInstructor}>+ Add instructor</button></div>
    </div>
    <p className="record-sheet-mobile-hint">Scroll the table left or right to reach the grade and other fields.</p>
    <div className="record-sheet-scroll" role="region" aria-label="Course entry table, scroll to see all columns" tabIndex={0}>
      <table className="record-entry-table">
        <caption className="sr-only">Editable course records for {student.name}. Tab moves between fields. Enter saves the current row.</caption>
        <thead><tr><th scope="col">Course</th><th scope="col" className="record-units">Units</th><th scope="col">Instructor</th><th scope="col">Grade</th><th scope="col">Status</th><th scope="col">School year</th><th scope="col">Term taken</th><th scope="col"><span className="sr-only">Save record</span></th></tr></thead>
        <tbody>{visibleCourses.length ? visibleCourses.map(course => {
          const draft = drafts[course.code] || fields(course, academicTerm);
          const dirty = dirtyCodes.has(course.code);
          const errorId = `${errorPrefix}-${course.code.replaceAll(' ', '-')}`;
          return <Fragment key={course.code}>
            <tr className={`${dirty ? 'record-row-dirty' : ''} ${errors[course.code] ? 'record-row-error' : ''}`}
              onKeyDown={event => { if (event.key === 'Enter' && event.target.tagName === 'INPUT' && dirty) { event.preventDefault(); saveCourses([course]); } }}>
              <th scope="row" className="record-course"><strong>{course.code}{dirty && <span className="record-dirty-dot" aria-label="Unsaved changes" />}</strong><span>{course.title}</span><small>{course.sourceRequirementColumn === 'Labhours' ? 'OJT requirement' : 'Prerequisite'}: {course.prerequisite}</small></th>
              <td className="record-units">{course.units}</td>
              <td><select aria-label={`${course.code} instructor`} aria-describedby={errors[course.code] ? errorId : undefined} value={draft.instructor} disabled={saving} onChange={event => edit(course, { instructor: event.target.value })}><option value="">Unassigned</option>{draft.instructor && !instructors.some(item => item.name === draft.instructor) && <option value={draft.instructor}>{draft.instructor}</option>}{instructors.map(item => <option key={item.id} value={item.name}>{item.name}</option>)}</select></td>
              <td><input className="record-grade-input" aria-label={`${course.code} grade`} aria-describedby={errors[course.code] ? errorId : undefined} type="number" inputMode="decimal" min="1" max="5" step="0.01" value={draft.grade} placeholder="—" disabled={saving} onChange={event => changeGrade(course, event.target.value)} /></td>
              <td><select aria-label={`${course.code} status`} className={`record-status-select ${draft.status.toLowerCase().replaceAll(' ', '-')}`} value={draft.status} disabled={saving} onChange={event => edit(course, { status: event.target.value, ...(!['Passed', 'Failed'].includes(event.target.value) ? { grade: '' } : {}) })}>{statuses.map(status => <option key={status}>{status}</option>)}</select></td>
              <td><input aria-label={`${course.code} school year starts`} type="number" min="2000" max="2199" step="1" value={draft.status === 'Not taken' ? '' : draft.schoolYear} placeholder="Not taken" disabled={saving || draft.status === 'Not taken'} onChange={event => edit(course, { schoolYear: event.target.value })} /><span className="record-year-end">{draft.status === 'Not taken' ? 'Not recorded' : `${draft.schoolYear || '…'}–${draft.schoolYear ? Number(draft.schoolYear) + 1 : '…'}`}</span></td>
              <td><select aria-label={`${course.code} term taken`} value={draft.semester} disabled={saving || draft.status === 'Not taken'} onChange={event => edit(course, { semester: event.target.value })}>{Object.entries(termLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
              <td className="record-save-cell"><button type="button" className={dirty ? 'primary-button' : 'secondary-button'} disabled={saving || !dirty} onClick={() => saveCourses([course])} aria-label={`Save ${course.code} record`}>{saving && dirty ? 'Saving…' : saved[course.code] && !dirty ? '✓ Saved' : 'Save'}</button></td>
            </tr>
            {errors[course.code] && <tr className="record-error-row"><td colSpan={8}><p id={errorId} role="alert">{course.code}: {errors[course.code]}</p></td></tr>}
          </Fragment>;
        }) : <tr><td colSpan={8} className="empty">No courses in this year and term.</td></tr>}</tbody>
      </table>
    </div>
    <div className="record-sheet-footer">
      <div><p className={dirtyCourses.length ? 'record-unsaved' : ''} role="status" aria-live="polite">{saving ? 'Saving records…' : notice || (dirtyCourses.length ? `${dirtyCourses.length} unsaved ${dirtyCourses.length === 1 ? 'record' : 'records'}${hiddenChanges ? ` (${hiddenChanges} in other terms)` : ''}` : 'All changes saved')}</p><span>Tab between fields · Enter to save a row<span className="record-scroll-hint"> · Scroll for more columns</span></span></div>
      <div className="record-sheet-actions"><button type="button" className="secondary-button" disabled={saving || !dirtyCourses.length} onClick={discard}>Discard changes</button><button type="button" className="primary-button" disabled={saving || !dirtyCourses.length} onClick={() => saveCourses(dirtyCourses)}>{saving ? 'Saving…' : `Save all changes${dirtyCourses.length ? ` (${dirtyCourses.length})` : ''}`}</button></div>
    </div>
  </section>;
}
