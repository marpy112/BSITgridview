import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { courses } from '../data.js';
import CurriculumFilters from '../CurriculumFilters.jsx';
import ExportButton from '../ExportButton.jsx';
import RecordTable from './RecordTable.jsx';
import { StudentRetakes } from '../CourseAttempts.jsx';
import { gradeForAverage } from '../../shared/retakes.js';
import StudentEditor from './StudentEditor.jsx';
import InstructorManager, { InstructorDialog } from './InstructorManager.jsx';
import ResetStudentPasswordDialog from './ResetStudentPasswordDialog.jsx';
import AcademicTermPanel from './AcademicTermPanel.jsx';
import { defaultAcademicTerm, academicTermLabel } from '../../shared/academic.js';
export { validateRecord } from './RecordEditor.jsx';
import { courseHeaders, courseExportRows } from '../export.js';
import GraduationNotice, { graduationState } from '../GraduationNotice.jsx';
import GraduationApprovalDialog from './GraduationApprovalDialog.jsx';
import DashboardOverview from './DashboardOverview.jsx';
import DeansList from './DeansList.jsx';
import AdminIcon from './AdminIcon.jsx';
import { matchesStudentFilter } from './dashboard-data.js';
import './dashboard.css';
const CertificateManager = lazy(() => import('../certificates/CertificateManager.jsx'));

export function studentSummary(student) {
  const complete = student.courses.filter(course => course.status === 'Passed');
  const graded = student.courses.filter(course => gradeForAverage(course) !== null);
  const units = graded.reduce((sum, course) => sum + course.units, 0);
  return {
    complete: complete.length,
    pending: student.courses.filter(course => ['Incomplete', 'In progress', 'Failed'].includes(course.status)).length,
    average: units ? (graded.reduce((sum, course) => sum + gradeForAverage(course) * course.units, 0) / units).toFixed(2) : '—',
  };
}

export default function AdminDashboard({ students, activity, instructors = [], onCreateInstructor, onResetStudentPassword, onApproveGraduation, academicTerm=defaultAcademicTerm, onCreateStudent, onUpdateStudent, onUpdateAcademicTerm, onUpdateRecord, onStartRetake, onLogout }) {
  const [page, setPage] = useState('dashboard');
  const [year, setYear] = useState('2');
  const [semester, setSemester] = useState(academicTerm.semester);
  const termCourses = courses.filter(course => course.year === Number(year) && course.semester === semester);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('All students');
  const [directoryYear, setDirectoryYear] = useState('all');
  const [directoryPage, setDirectoryPage] = useState(1);
  const headingRef = useRef(null);
  const [selectedId, setSelectedId] = useState(null);
  const [hasUnsavedRecords, setHasUnsavedRecords] = useState(false);
  const [recordsSaving, setRecordsSaving] = useState(false);
  const [profileEditor,setProfileEditor] = useState(null);
  const [instructorEditor, setInstructorEditor] = useState(false);
  const [passwordReset, setPasswordReset] = useState(null);
  const [graduationReview, setGraduationReview] = useState(null);
  const [adminNotice, setAdminNotice] = useState('');
  useEffect(() => { setDirectoryPage(1); }, [query, filter, directoryYear]);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [page, selectedId]);
  useEffect(() => setAdminNotice(''), [selectedId]);
  useEffect(() => setSemester(academicTerm.semester),[academicTerm.semester,academicTerm.schoolYearStart]);
  const selected = students.find(student => student.id === selectedId);
  const filtered = students.filter(student =>
    `${student.name} ${student.id} ${student.program}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()) &&
    (directoryYear === 'all' || String(student.year) === directoryYear) &&
    (filter === 'Awaiting graduation approval' ? student.studentStatus !== 'Graduated' && graduationState(student).eligible : matchesStudentFilter(student, filter))
  ).sort((a, b) => a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id)));
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentDirectoryPage = Math.min(directoryPage, pageCount);
  const firstResult = (currentDirectoryPage - 1) * pageSize;
  const visibleStudents = filtered.slice(firstResult, firstResult + pageSize);
  const selectedCourses = selected?.courses.filter(course => course.year === Number(year) && course.semester === semester) || [];
  const studentExportHeaders = ['Student number', 'Student name', 'Program', 'Year level', 'GWA', 'Completed courses', 'Pending records', 'Standing','Student status','Student type','Previous school'];
  const studentExportRows = filtered.map(student => {
    const summary = studentSummary(student);
    return [student.id, student.name, student.program, student.year, summary.average, summary.complete, summary.pending, summary.pending ? `${summary.pending} pending` : summary.complete === student.courses.length ? 'Completed' : 'Not started',student.studentStatus || 'Active',student.isTransferee ? 'Transferee' : 'Regular',student.previousSchool || ''];
  });

  async function saveStudent(input) {
    if(profileEditor.student) { await onUpdateStudent(profileEditor.student.id,input); if(selectedId===profileEditor.student.id) setYear(String(input.year)); }
    else { const id=await onCreateStudent(input);setPage('students');setSelectedId(id);setYear(String(input.year));setSemester(academicTerm.semester);setQuery('');setFilter('All students'); }
  }

  async function resetPassword(id) {
    await onResetStudentPassword(id);
    setAdminNotice('Password reset. The student must sign in with their exact last name and choose a new password.');
  }

  function canLeaveRecords() { return !recordsSaving && (!hasUnsavedRecords || window.confirm('You have unsaved course changes. Leave without saving?')); }
  function changePage(next) { if (canLeaveRecords()) { setPage(next); setSelectedId(null); } }

  function openDirectory({ query = '', filter = 'All students', year = 'all', page: nextPage = 'students' } = {}) {
    if (!canLeaveRecords()) return;
    setPage(nextPage); setSelectedId(null); setQuery(query); setFilter(filter);
    setDirectoryYear(year); setDirectoryPage(1);
  }

  function reviewStudent(student) {
    if (!canLeaveRecords()) return;
    setSelectedId(student.id); setPage('students'); setYear(String(student.year)); setSemester(academicTerm.semester);
  }

  async function approveGraduation(id) {
    await onApproveGraduation(id);
    setAdminNotice('Graduation approved. Student status changed to Graduated.');
  }

  return <div className="admin-shell"><aside className="sidebar admin-sidebar"><a className="brand" href="#/admin/dashboard" onClick={event => { event.preventDefault(); changePage('dashboard'); }}><span className="brand-icon">g<span>•</span></span><span className="brand-name"><small>BSIT </small>gradeview</span><span className="brand-dot">.</span></a><div className="workspace">ADMIN WORKSPACE</div><nav aria-label="Admin navigation">{[['dashboard', '▦', 'Dashboard'], ['students', '♙', 'Students'], ['courses', '▤', 'Courses'], ['instructors', '\u2667', 'Instructors'], ['deans-list', '', 'Dean’s List'], ['certificates', '\u25a7', 'E-certificates']].map(([id, icon, label]) => <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => changePage(id)} aria-label={label} aria-current={page === id ? 'page' : undefined}><AdminIcon name={id} /><span className="admin-nav-label">{label}</span></button>)}</nav><div className="sidebar-bottom"><div className="help-card"><span className="help-icon">✧</span><h3>Every record tells a story.</h3><p>Help every student see their next step.</p></div><div className="student"><span className="avatar">AD</span><div><strong>Academic administrator</strong><small>{"Administrator"}</small></div></div></div><button className="admin-sidebar-logout secondary-button" onClick={() => { if (canLeaveRecords()) onLogout(); }}>Sign out</button></aside>
  <main className="admin-main"><header><div className="breadcrumb">Admin portal <span>/</span><strong>{({dashboard: 'Dashboard', students: 'Students', courses: 'Courses', instructors: 'Instructors', 'deans-list': 'Dean’s List', certificates: 'E-certificates'})[page]}</strong></div><div className="header-right"><span className="portal-status"><i /> {"Connected to database"}</span><button className="secondary-button header-logout" onClick={() => { if (canLeaveRecords()) onLogout(); }}>Sign out</button></div></header>
  <div className="page-heading"><div><div className="eyebrow">ACADEMIC ADMINISTRATION</div><h1 ref={headingRef} tabIndex={-1}>{({dashboard: 'Academic overview', students: 'Student records', courses: 'Course directory', instructors: 'Instructors', 'deans-list': 'Dean’s List', certificates: 'E-certificates'})[page]}<span>.</span></h1><p>{page === 'dashboard' ? 'A clear view of student progress and what needs your attention.' : page === 'students' ? 'Find a student to review and update their grades.' : page === 'certificates' ? 'Create, issue and verify certificates from your department.' : page === 'deans-list' ? 'Verify semester qualifications and print students with complete final grades.' : page === 'instructors' ? 'Find instructors and review their subjects, school years, and year levels.' : 'The four-year BSIT curriculum, organized by year and term.'}</p></div><div className="admin-page-actions"><button className="primary-button" disabled={recordsSaving} onClick={() => { if (canLeaveRecords()) setProfileEditor({student:null}); }}>+ Add student</button><span className="admin-term">{academicTermLabel(academicTerm)}</span></div></div>
  {page === 'dashboard' ? <details className="dashboard-term-controls"><summary><span>Academic term settings</span><span>Manage active school year and semester</span></summary><AcademicTermPanel term={academicTerm} onSave={onUpdateAcademicTerm} /></details> : !['certificates', 'deans-list'].includes(page) && <AcademicTermPanel term={academicTerm} onSave={onUpdateAcademicTerm} />}
  {page === 'dashboard' && <DashboardOverview students={students} activity={activity} academicTerm={academicTerm} onOpenDirectory={openDirectory} onReviewStudent={reviewStudent} />}
  {page === 'students' && <section className="admin-panel student-directory"><div className="admin-section-heading"><div><h2>{selected ? 'Student progress record' : 'Student directory'} <span className="count-pill">{selected ? selectedCourses.length : filtered.length}</span></h2><p>{selected ? 'Enter grades in the table, then save a row or all changes.' : 'Search or filter the directory, then open a student record. PDF exports include all matching students.'}</p></div><ExportButton filename={selected ? `student-${selected.id}-year-${year}-${semester}.pdf` : 'student-directory.pdf'} headers={selected ? ['Student number','Student name',...courseHeaders] : studentExportHeaders} rows={selected ? courseExportRows(selectedCourses).map(row => [selected.id,selected.name,...row]) : studentExportRows} description={selected ? 'selected student progress records' : 'student directory'} metadata={selected ? [`Current academic term: ${academicTermLabel(academicTerm)}`,`Student: ${selected.name} | Student ID: ${selected.id}`, `Year ${year} | ${semester === "summer" ? "Summer" : "Semester " + semester}`] : [`Current academic term: ${academicTermLabel(academicTerm)}`,`Filter: ${filter}`, `Student year: ${directoryYear === 'all' ? 'All years' : directoryYear}`, ...(query.trim() ? [`Search: ${query.trim().slice(0,200)}`] : [])]} />{selected && <button className="secondary-button" disabled={recordsSaving} onClick={() => { if (canLeaveRecords()) setSelectedId(null); }}>← All students</button>}</div>
  {!selected ? <><div className="directory-toolbar"><label className="admin-search"><AdminIcon name="search" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name, student number, or program" aria-label="Search students" />{query && <button className="directory-clear-search" aria-label="Clear search" onClick={() => setQuery('')}>×</button>}</label><select value={filter} onChange={event => setFilter(event.target.value)} aria-label="Filter students"><option>All students</option><option>Needs follow-up</option><option>Incomplete grades</option><option>Failed courses</option><option>No recorded grades</option><option>With pending records</option><option>With passed records</option><option>Awaiting graduation approval</option><option>Transferees</option><option>Active</option><option>Inactive</option><option>Graduated</option></select><select aria-label="Filter by student year" value={directoryYear} onChange={event => setDirectoryYear(event.target.value)}><option value="all">All years</option>{[1,2,3,4].map(value => <option key={value} value={value}>Year {value}</option>)}</select></div><div className="directory-result-summary" role="status">{filtered.length} matching {filtered.length === 1 ? 'student' : 'students'}{(query || filter !== 'All students' || directoryYear !== 'all') && <button className="text-button" onClick={() => { setQuery(''); setFilter('All students'); setDirectoryYear('all'); }}>Clear filters</button>}</div><div className="student-list">{filtered.length ? visibleStudents.map(student => { const summary = studentSummary(student); return <article className="student-list-row" key={student.id}><div className="directory-student"><span className="avatar">{student.name.split(/[,\s]+/).filter(Boolean).slice(0,2).map(name => name[0]).join('')}</span><div><h3>{student.name}</h3><small>{student.id} · Year {student.year}</small></div></div><span className="directory-program">{student.program}<small className={`student-status-label ${(student.studentStatus || "Active").toLowerCase()}`}>{student.studentStatus || "Active"}</small>{student.isTransferee && <small className="transferee-label">Transferee · {student.previousSchool}</small>}</span><div className="directory-average"><span>GWA</span><strong>{summary.average}</strong></div><span className={`badge ${summary.pending ? 'in-progress' : summary.complete === student.courses.length ? 'passed' : 'not-taken'}`}>{student.studentStatus !== 'Graduated' && graduationState(student).eligible ? 'Awaiting graduation approval' : summary.pending ? `${summary.pending} pending` : summary.complete === student.courses.length ? 'Completed' : 'Not started'}</span><button className="secondary-button" aria-label={`View record for ${student.name}`} onClick={() => reviewStudent(student)}>View record <span aria-hidden="true">→</span></button></article>; }) : <div className="dashboard-empty" role="status"><AdminIcon name="search" /><h3>{students.length ? 'No matching students' : 'Your directory is ready'}</h3><p>{students.length ? 'Try a different name, student number, or filter.' : 'Add your first student to start managing academic records.'}</p><button className="secondary-button" onClick={() => students.length ? openDirectory() : setProfileEditor({ student: null })}>{students.length ? 'Clear search and filters' : 'Add student'}</button></div>}</div><div className="directory-footer"><span role="status">Showing {filtered.length ? firstResult + 1 : 0}–{Math.min(firstResult + pageSize, filtered.length)} of {filtered.length} students</span><nav aria-label="Student directory pages"><button className="secondary-button" disabled={currentDirectoryPage === 1} onClick={() => setDirectoryPage(currentDirectoryPage - 1)}>Previous</button><span aria-live="polite">Page {currentDirectoryPage} of {pageCount}</span><button className="secondary-button" disabled={currentDirectoryPage >= pageCount} onClick={() => setDirectoryPage(currentDirectoryPage + 1)}>Next</button></nav></div></> : <><div className="selected-student-summary"><div><h3>{selected.name}</h3><p>{selected.id} · {selected.program}</p>{selected.isTransferee && <span className="transferee-label">Transferee / {selected.previousSchool}</span>}</div><div className="student-summary-actions"><span className={`student-status-label ${(selected.studentStatus || "Active").toLowerCase()}`}>{selected.studentStatus || "Active"}</span><span className="admin-term">Year {selected.year} | GWA {studentSummary(selected).average}</span><button className="secondary-button" disabled={recordsSaving} onClick={() => setProfileEditor({student:selected})}>Edit student details</button><button className="secondary-button" disabled={recordsSaving} onClick={() => setPasswordReset(selected)}>Reset password</button></div></div>{adminNotice && <p className="admin-action-notice" role="status">{adminNotice}</p>}<GraduationNotice student={selected} onApprove={() => setGraduationReview(selected)} disabled={recordsSaving} unsaved={hasUnsavedRecords} /><StudentRetakes courses={selected.courses} disabled={recordsSaving} onSelect={course => { setYear(String(course.year)); setSemester(course.semester); }} /><CurriculumFilters year={year} semester={semester} onYearChange={setYear} onSemesterChange={setSemester} disabled={recordsSaving} /><RecordTable key={selected.id} student={selected} visibleCourses={selectedCourses} academicTerm={academicTerm} instructors={instructors} onStartRetake={onStartRetake} onAddInstructor={() => setInstructorEditor(true)} onSave={onUpdateRecord} onDirtyChange={setHasUnsavedRecords} onBusyChange={setRecordsSaving} /></>}
  </section>}
  {page === 'courses' && <section className="admin-panel"><div className="admin-section-heading"><div><h2>Curriculum courses <span className="count-pill">{termCourses.length}</span></h2><p>Course titles, instructors, and assigned students.</p></div><ExportButton filename={`curriculum-year-${year}-${semester}.pdf`} headers={['Year','Term','Course code','Descriptive title','Instructor','Units','Prerequisite / OJT requirement','Students assigned']} rows={courseExportRows(termCourses).map(row => [...row.slice(0,6),row[8],students.length])} description="course directory" metadata={[`Year ${year} | ${semester === "summer" ? "Summer" : "Semester " + semester}`, "BSIT curriculum revised 2023 | Effective AY 2023-2024"]} /></div><CurriculumFilters year={year} semester={semester} onYearChange={setYear} onSemesterChange={setSemester} /><div className="admin-record-grid">{termCourses.map(course => <article key={course.code} className="admin-record-card"><div className="course-card-heading"><strong className="course-card-code">{course.code}</strong><span className="admin-course-units">{course.units} units</span></div><h3>{course.title}</h3><p><span>Instructor</span>{course.instructor}</p><p><span>{course.sourceRequirementColumn === "Labhours" ? "OJT requirement (source: Labhours)" : "Prerequisite"}</span>{course.prerequisite}</p><div className="admin-course-enrollment">{students.length} students assigned <span>{course.category}</span></div></article>)}</div></section>}
  {page === 'deans-list' && <DeansList academicTerm={academicTerm} students={students} onReviewStudent={reviewStudent} />}
  {page === 'instructors' && <InstructorManager instructors={instructors} students={students} onAdd={() => setInstructorEditor(true)} />}
  {page === 'certificates' && <Suspense fallback={<div className="admin-panel empty" role="status">Loading certificates…</div>}><CertificateManager students={students} /></Suspense>}
  <div className="admin-record-note"><span>{"BSIT gradeview academic records"}</span><span>{"Changes are saved to the database."}</span></div><footer><a className="footer-brand" href="#/admin/dashboard" onClick={event => { event.preventDefault(); changePage('dashboard'); }}>BSIT gradeview.</a><span>A little clarity for your academic journey.</span><span>{"Administrator portal"}</span></footer></main>
  {profileEditor && <StudentEditor student={profileEditor.student} onSave={saveStudent} onClose={() => setProfileEditor(null)} />}
  {instructorEditor && <InstructorDialog onSave={onCreateInstructor} onClose={() => setInstructorEditor(false)} />}
  {passwordReset && <ResetStudentPasswordDialog student={passwordReset} onReset={resetPassword} onClose={() => setPasswordReset(null)} />}
  {graduationReview && <GraduationApprovalDialog student={students.find(student => student.id === graduationReview.id) || graduationReview} onApprove={approveGraduation} onClose={() => setGraduationReview(null)} />}
  </div>;
}
