import { Fragment, useEffect, useId, useState } from 'react';
import { academicYearLabel } from '../../shared/academic.js';
import { termLabels } from '../data.js';
import { validateRecord } from './RecordEditor.jsx';
import GradeSelect from './GradeSelect.jsx';
import { normalizeSchoolAcronym, validSchoolAcronym } from '../../shared/transfer.js';
import { nextRetakeTerm } from '../../shared/retakes.js';
import { RetakeNote, AttemptHistory } from '../CourseAttempts.jsx';
import RetakeDialog from './RetakeDialog.jsx';
import './record-table.css';

const statuses = ['Not taken', 'In progress', 'Incomplete', 'Passed', 'Failed'];

function fields(course, academicTerm, student) {
  return {
    grade: course.grade === null ? '' : course.grade.toFixed(2),
    status: course.status,
    instructor: course.instructor === 'Unassigned' ? '' : course.instructor,
    schoolYear: course.status === 'Failed' && !course.academicYearTaken ? '' : (course.academicYearTaken || academicYearLabel(academicTerm)).slice(0, 4),
    semester: course.semesterTaken || course.semester || academicTerm.semester,
    isTransferred: Boolean(course.transferSchool),
    transferSchool: course.transferSchool || student.previousSchool || '',
    expectedAttemptNumber: course.attemptNumber || 1,
    expectedRecordVersion: course.recordVersion || 0,
  };
}

function payload(draft) {
  return {
    grade: draft.grade === '' ? null : Number(draft.grade),
    status: draft.status,
    instructor: draft.instructor.trim() || 'Unassigned',
    academicYearTaken: draft.status === 'Not taken' ? '' : `${draft.schoolYear}–${Number(draft.schoolYear) + 1}`,
    semesterTaken: draft.status === 'Not taken' ? '' : draft.semester,
    transferSchool: draft.isTransferred ? normalizeSchoolAcronym(draft.transferSchool) : '',
    expectedAttemptNumber: draft.expectedAttemptNumber,
    expectedRecordVersion: draft.expectedRecordVersion,
  };
}

function validation(draft) {
  const message = validateRecord(draft.grade, draft.status);
  if (message) return message;
  if (draft.isTransferred && (draft.grade === '' || !validSchoolAcronym(normalizeSchoolAcronym(draft.transferSchool)))) return 'Choose a final grade and enter the previous school acronym for this transferred grade (up to 30 characters).';
  const grade = Number(draft.grade);
  if (draft.grade !== '' && Math.abs(grade * 100 - Math.round(grade * 100)) > 0.00001) return 'Use no more than two decimal places for the grade.';
  if (draft.instructor.trim().length > 120) return 'Instructor must be 120 characters or fewer.';
  if (draft.status !== 'Not taken' && (!/^\d{4}$/.test(draft.schoolYear) || Number(draft.schoolYear) < 2000 || Number(draft.schoolYear) > 2199)) return 'Enter a school year starting between 2000 and 2199.';
  return '';
}

export default function RecordTable({ student, visibleCourses, academicTerm, instructors, onAddInstructor, onStartRetake, onSave, onDirtyChange, onBusyChange }) {
  const [drafts, setDrafts] = useState({});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState({});
  const [notice, setNotice] = useState('');
  const [retaking, setRetaking] = useState(null);
  const errorPrefix = useId();
  const showTransferSchool = student.isTransferee || student.courses.some(course => course.transferSchool);
  const dirtyCourses = student.courses.filter(course => drafts[course.code] &&
    JSON.stringify(payload(drafts[course.code])) !== JSON.stringify(payload(fields(course, academicTerm, student))));
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
    setDrafts(current => ({ ...current, [course.code]: { ...(current[course.code] || fields(course, academicTerm, student)), ...changes } }));
    setErrors(current => ({ ...current, [course.code]: '' }));
    setSaved(current => ({ ...current, [course.code]: false }));
    setNotice('');
  }

  function changeGrade(course, value) {
    const current = drafts[course.code] || fields(course, academicTerm, student);
    const next = { grade: value };
    if (value !== '' && Number(value) >= 1 && Number(value) <= 5) next.status = Number(value) <= 3 ? 'Passed' : 'Failed';
    else if (value === '' && ['Passed', 'Failed'].includes(current.status)) next.status = 'In progress';
    if (value === '') next.isTransferred = false;
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

  async function startRetake(course) {
    setSaving(true);
    try {
      await onStartRetake(student.id, course.code, { expectedAttemptNumber: course.attemptNumber || 1, expectedRecordVersion: course.recordVersion || 0 });
      setDrafts(current => { const next = { ...current }; delete next[course.code]; return next; });
      setNotice(`Retake started for ${course.code}. The failed result is kept in its attempt history.`);
    } finally { setSaving(false); }
  }

  return <section className="record-sheet" aria-label="Edit student course records" aria-busy={saving}>
    <div className="record-sheet-heading">
      <div><h3>Course grades <span>{visibleCourses.length} courses</span></h3><p>Select a grade. Passing and failing statuses are selected for you.</p></div>
      <div className="record-sheet-heading-actions"><span className="record-sheet-scale">1.00 highest <span>·</span> 3.00 passing limit</span><button type="button" className="secondary-button" disabled={saving} onClick={onAddInstructor}>+ Add instructor</button></div>
    </div>
    {showTransferSchool && <p className="transfer-entry-help">For grades from another school, select a grade, check <strong>Transferred</strong>, and enter the school acronym. Leave current-school grades unmarked.</p>}
    <p className="record-sheet-mobile-hint">Scroll the table left or right to reach the grade and other fields.</p>
    <div className="record-sheet-scroll" role="region" aria-label="Course entry table, scroll to see all columns" tabIndex={0}>
      <table className={`record-entry-table${showTransferSchool ? ' transfer-record-table' : ''}`}>
        <caption className="sr-only">Editable course records for {student.name}. Tab moves between fields. Enter saves the current row.</caption>
        <thead><tr><th scope="col">Course</th><th scope="col" className="record-units">Units</th><th scope="col">Instructor</th><th scope="col">Grade</th>{showTransferSchool && <th scope="col">School of origin</th>}<th scope="col">Status</th><th scope="col">School year</th><th scope="col">Term taken</th><th scope="col"><span className="sr-only">Save record</span></th></tr></thead>
        <tbody>{visibleCourses.length ? visibleCourses.map(course => {
          const draft = drafts[course.code] || fields(course, academicTerm, student);
          const dirty = dirtyCodes.has(course.code);
          const errorId = `${errorPrefix}-${course.code.replaceAll(' ', '-')}`;
          return <Fragment key={course.code}>
            <tr className={`${dirty ? 'record-row-dirty' : ''} ${errors[course.code] ? 'record-row-error' : ''}`}
              onKeyDown={event => { if (event.key === 'Enter' && event.target.tagName === 'INPUT' && dirty) { event.preventDefault(); saveCourses([course]); } }}>
              <th scope="row" className="record-course"><strong>{course.code}{dirty && <span className="record-dirty-dot" aria-label="Unsaved changes" />}</strong><span>{course.title}</span><small>{course.sourceRequirementColumn === 'Labhours' ? 'OJT requirement' : 'Prerequisite'}: {course.prerequisite}</small><RetakeNote course={course} /><AttemptHistory course={course} />{course.status === 'Failed' && <button type="button" className="retake-start-button" disabled={saving || dirty || !nextRetakeTerm(course.academicYearTaken, course.semesterTaken)} onClick={() => setRetaking(course)} aria-label={`Start ${course.code} retake`}>{dirty ? 'Save row before retake' : 'Start retake'}</button>}</th>
              <td className="record-units">{course.units}</td>
              <td><select aria-label={`${course.code} instructor`} aria-describedby={errors[course.code] ? errorId : undefined} value={draft.instructor} disabled={saving} onChange={event => edit(course, { instructor: event.target.value })}><option value="">Unassigned</option>{draft.instructor && !instructors.some(item => item.name === draft.instructor) && <option value={draft.instructor}>{draft.instructor}</option>}{instructors.map(item => <option key={item.id} value={item.name}>{item.name}</option>)}</select></td>
              <td><GradeSelect className="record-grade-select" aria-label={`${course.code} grade`} aria-describedby={errors[course.code] ? errorId : undefined} value={draft.grade} disabled={saving} onChange={event => changeGrade(course, event.target.value)} /></td>
              {showTransferSchool && <td><label className="transfer-origin-toggle"><input type="checkbox" aria-label={`${course.code} transferred grade`} checked={draft.isTransferred} disabled={saving || draft.grade === ''} onChange={event => edit(course, { isTransferred: event.target.checked })} />Transferred</label><input className="transfer-school-input" aria-label={`${course.code} school acronym`} maxLength={30} value={draft.isTransferred ? draft.transferSchool : ''} placeholder={draft.isTransferred ? 'School acronym' : 'Current school'} disabled={saving || !draft.isTransferred} onChange={event => edit(course, { transferSchool: event.target.value.toUpperCase() })} /></td>}
              <td><select aria-label={`${course.code} status`} className={`record-status-select ${draft.status.toLowerCase().replaceAll(' ', '-')}`} value={draft.status} disabled={saving} onChange={event => edit(course, { status: event.target.value, ...(!['Passed', 'Failed'].includes(event.target.value) ? { grade: '', isTransferred: false } : {}) })}>{statuses.map(status => <option key={status} disabled={status === 'Not taken' && course.attemptNumber > 1}>{status}</option>)}</select></td>
              <td><input aria-label={`${course.code} school year starts`} type="number" min="2000" max="2199" step="1" value={draft.status === 'Not taken' ? '' : draft.schoolYear} placeholder={draft.status === 'Not taken' ? 'Not taken' : 'Year'} disabled={saving || draft.status === 'Not taken' || course.attemptNumber > 1} onChange={event => edit(course, { schoolYear: event.target.value })} /><span className="record-year-end">{draft.status === 'Not taken' ? 'Not recorded' : `${draft.schoolYear || '…'}–${draft.schoolYear ? Number(draft.schoolYear) + 1 : '…'}`}</span></td>
              <td><select aria-label={`${course.code} term taken`} value={draft.semester} disabled={saving || draft.status === 'Not taken' || course.attemptNumber > 1} onChange={event => edit(course, { semester: event.target.value })}>{Object.entries(termLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
              <td className="record-save-cell"><button type="button" className={dirty ? 'primary-button' : 'secondary-button'} disabled={saving || !dirty} onClick={() => saveCourses([course])} aria-label={`Save ${course.code} record`}>{saving && dirty ? 'Saving…' : saved[course.code] && !dirty ? '✓ Saved' : 'Save'}</button></td>
            </tr>
            {errors[course.code] && <tr className="record-error-row"><td colSpan={showTransferSchool ? 9 : 8}><p id={errorId} role="alert">{course.code}: {errors[course.code]}</p></td></tr>}
          </Fragment>;
        }) : <tr><td colSpan={showTransferSchool ? 9 : 8} className="empty">No courses in this year and term.</td></tr>}</tbody>
      </table>
    </div>
    <div className="record-sheet-footer">
      <div><p className={dirtyCourses.length ? 'record-unsaved' : ''} role="status" aria-live="polite">{saving ? 'Saving records…' : notice || (dirtyCourses.length ? `${dirtyCourses.length} unsaved ${dirtyCourses.length === 1 ? 'record' : 'records'}${hiddenChanges ? ` (${hiddenChanges} in other terms)` : ''}` : 'All changes saved')}</p><span>Tab between fields · Enter to save a row<span className="record-scroll-hint"> · Scroll for more columns</span></span></div>
      <div className="record-sheet-actions"><button type="button" className="secondary-button" disabled={saving || !dirtyCourses.length} onClick={discard}>Discard changes</button><button type="button" className="primary-button" disabled={saving || !dirtyCourses.length} onClick={() => saveCourses(dirtyCourses)}>{saving ? 'Saving…' : `Save all changes${dirtyCourses.length ? ` (${dirtyCourses.length})` : ''}`}</button></div>
    </div>
    {retaking && <RetakeDialog student={student} course={retaking} onStart={startRetake} onClose={() => setRetaking(null)} />}
  </section>;
}
