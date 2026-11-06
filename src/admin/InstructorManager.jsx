import { useEffect, useMemo, useRef, useState } from 'react';
import AdminIcon from './AdminIcon.jsx';
import { buildInstructorDirectory, filterInstructorDirectory } from './instructor-assignments.js';
import './admin-tools.css';
import './instructor-assignments.css';

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

const semesterLabels = { '1': '1st semester', '2': '2nd semester', summer: 'Summer', '': 'Not recorded' };
const displayYear = value => value ? value.replace('-', '–') : 'Not recorded';

export default function InstructorManager({ instructors = [], students = [], onAdd }) {
  const [query, setQuery] = useState('');
  const [schoolYear, setSchoolYear] = useState('all');
  const [semester, setSemester] = useState('all');
  const [yearLevel, setYearLevel] = useState('all');
  const [expanded, setExpanded] = useState({});
  const directory = useMemo(() => buildInstructorDirectory(instructors, students), [instructors, students]);
  const schoolYears = useMemo(() => [...new Set(directory.flatMap(instructor => instructor.assignments.map(assignment => assignment.schoolYear)))].sort((a, b) => b.localeCompare(a)), [directory]);
  const hasFilters = schoolYear !== 'all' || semester !== 'all' || yearLevel !== 'all';
  const filtered = useMemo(() => filterInstructorDirectory(directory, { query, schoolYear, semester, yearLevel }), [directory, query, schoolYear, semester, yearLevel]);
  function changeFilter(setter, value) { setter(value); setExpanded({}); }
  function clearFilters() { setQuery(''); setSchoolYear('all'); setSemester('all'); setYearLevel('all'); setExpanded({}); }

  return <section className="admin-panel instructor-directory">
    <div className="admin-section-heading"><div><h2>Instructor directory <span className="count-pill">{directory.length}</span></h2><p>Find an instructor and see the subjects they handle by school year, semester, and year level.</p></div><button className="primary-button" onClick={onAdd}>+ Add instructor</button></div>
    <div className="instructor-filter-bar">
      <label className="instructor-filter-search"><span>Instructor name</span><span className="admin-search"><AdminIcon name="search" /><input aria-label="Search instructors" value={query} onChange={event => changeFilter(setQuery, event.target.value)} placeholder="Search instructor name" />{query && <button className="directory-clear-search" aria-label="Clear instructor search" onClick={() => changeFilter(setQuery, '')}>×</button>}</span></label>
      <label><span>School year</span><select value={schoolYear} onChange={event => changeFilter(setSchoolYear, event.target.value)}><option value="all">All school years</option>{schoolYears.map(value => <option key={value || 'unknown'} value={value || 'unknown'}>{displayYear(value)}</option>)}</select></label>
      <label><span>Semester</span><select value={semester} onChange={event => changeFilter(setSemester, event.target.value)}><option value="all">All semesters</option><option value="1">1st semester</option><option value="2">2nd semester</option><option value="summer">Summer</option><option value="unknown">Not recorded</option></select></label>
      <label><span>Year level</span><select value={yearLevel} onChange={event => changeFilter(setYearLevel, event.target.value)}><option value="all">All year levels</option>{[1,2,3,4].map(value => <option key={value} value={value}>Year {value}</option>)}<option value="unknown">Not recorded</option></select></label>
    </div>
    <div className="instructor-results-summary"><span role="status">{filtered.length} matching {filtered.length === 1 ? 'instructor' : 'instructors'}</span>{(query || hasFilters) && <button className="text-button" onClick={clearFilters}>Clear search and filters</button>}</div>
    <p className="instructor-source-note">Based on saved student course records, including previous attempts. Year level is the subject’s curriculum year. Missing terms are shown as “Not recorded.”</p>
    <div className="instructor-assignment-list">{filtered.length ? filtered.map(item => {
      const subjectCount = new Set(item.assignments.map(assignment => assignment.code)).size;
      const years = [...new Set(item.assignments.map(assignment => assignment.schoolYear))];
      const levels = [...new Set(item.assignments.map(assignment => assignment.yearLevel))].sort();
      const isExpanded = expanded[item.id] ?? Boolean(query.trim() || hasFilters);
      const contentId = `instructor-subjects-${encodeURIComponent(item.id)}`;
      return <article className="instructor-assignment-card" key={item.id}>
        <button className="instructor-assignment-heading" aria-expanded={isExpanded} aria-controls={contentId} onClick={() => setExpanded(previous => ({ ...previous, [item.id]: !isExpanded }))}>
          <span className="avatar" aria-hidden="true">{item.name.split(/[,\s]+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2)}</span>
          <span className="instructor-assignment-name"><strong>{item.name}</strong><small>{subjectCount} {subjectCount === 1 ? 'subject' : 'subjects'}{years.length > 0 && ` · ${years.length} ${years.length === 1 ? 'school year' : 'school years'}${years.includes('') ? ' (includes unrecorded)' : ''}`}</small></span>
          <span className="instructor-level-tags">{levels.map(level => <span key={level || 'unknown'}>{level ? `Year ${level}` : 'Year level not recorded'}</span>)}</span>
          <span className="instructor-expand-label">{isExpanded ? 'Hide subjects' : 'View subjects'} <span aria-hidden="true">{isExpanded ? '−' : '+'}</span></span>
        </button>
        <div id={contentId} hidden={!isExpanded} className="instructor-assignment-body">
          {item.assignments.length ? <ul className="instructor-subjects" aria-label={`Subjects handled by ${item.name}`}>{item.assignments.map(assignment => <li key={assignment.key}>
            <div className="instructor-subject-name"><strong>{assignment.code}</strong><span>{assignment.title}</span></div>
            <dl className="instructor-subject-facts"><div><dt>School year</dt><dd>{displayYear(assignment.schoolYear)}</dd></div><div><dt>Semester</dt><dd>{semesterLabels[assignment.semester]}</dd></div><div><dt>Year level</dt><dd>{assignment.yearLevel ? `Year ${assignment.yearLevel}` : 'Not recorded'}</dd></div><div><dt>Students</dt><dd>{assignment.students.toLocaleString()}</dd></div></dl>
          </li>)}</ul> : <div className="instructor-no-subjects"><AdminIcon name="courses" /><strong>No subjects assigned yet</strong><p>Select this instructor in a student’s course record to show the assignment here.</p></div>}
        </div>
      </article>;
    }) : <div className="instructor-no-results" role="status"><AdminIcon name="search" /><h3>{directory.length ? 'No matching instructors' : 'Add your first instructor'}</h3><p>{directory.length ? 'Try another name or adjust the school year, semester, or year level.' : 'Add an instructor to make their name available in the grade table.'}</p>{directory.length > 0 && <button className="secondary-button" onClick={clearFilters}>Clear search and filters</button>}</div>}</div>
    <div className="directory-footer">Showing {filtered.length} of {directory.length} instructors</div>
  </section>;
}
