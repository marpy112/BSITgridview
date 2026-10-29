import { lazy, Suspense, useEffect, useState } from 'react';
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
import GraduationNotice, { GraduationQueue, graduationState } from '../GraduationNotice.jsx';
import GraduationApprovalDialog from './GraduationApprovalDialog.jsx';
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
  const [selectedId, setSelectedId] = useState(null);
  const [hasUnsavedRecords, setHasUnsavedRecords] = useState(false);
  const [recordsSaving, setRecordsSaving] = useState(false);
  const [profileEditor,setProfileEditor] = useState(null);
  const [instructorEditor, setInstructorEditor] = useState(false);
  const [passwordReset, setPasswordReset] = useState(null);
  const [graduationReview, setGraduationReview] = useState(null);
  const [adminNotice, setAdminNotice] = useState('');
  useEffect(() => setAdminNotice(''), [selectedId]);
  useEffect(() => setSemester(academicTerm.semester),[academicTerm.semester,academicTerm.schoolYearStart]);
  const selected = students.find(student => student.id === selectedId);
  const records = students.flatMap(student => student.courses);
  const complete = records.filter(course => course.status === 'Passed').length;
  const pending = records.filter(course => ['Incomplete', 'In progress', 'Failed'].includes(course.status)).length;
  const percent = records.length ? Math.round(complete / records.length * 100) : 0;
  const filtered = students.filter(student => `${student.name} ${student.id} ${student.program}`.toLowerCase().includes(query.toLowerCase().trim()) && (filter === 'All students' || (filter === 'Awaiting graduation approval' ? student.studentStatus !== 'Graduated' && graduationState(student).eligible : filter === 'Transferees' ? student.isTransferee : filter === 'With pending records' ? studentSummary(student).pending > 0 : student.studentStatus === filter)));
  const selectedCourses = selected?.courses.filter(course => course.year === Number(year) && course.semester === semester) || [];
  const studentExportHeaders = ['Student number', 'Student name', 'Program', 'Year level', 'GWA', 'Completed courses', 'Pending records', 'Standing','Student status','Student type','Previous school'];
  const studentExportRows = filtered.map(student => {
    const summary = studentSummary(student);
    return [student.id, student.name, student.program, student.year, summary.average, summary.complete, summary.pending, summary.pending ? `${summary.pending} pending` : summary.complete === student.courses.length ? 'Completed' : 'Not started',student.studentStatus || 'Active',student.isTransferee ? 'Transferee' : 'Regular',student.previousSchool || ''];
  });
  const progressExportRows = courses.slice(0, 4).map(course => {
    const total = records.filter(record => record.code === course.code);
    const passed = total.filter(record => record.status === 'Passed').length;
    return [course.code, course.title, passed, total.length, `${total.length ? Math.round(passed / total.length * 100) : 0}%`];
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

  function reviewStudent(student) {
    if (!canLeaveRecords()) return;
    setSelectedId(student.id); setPage('students'); setYear(String(student.year)); setSemester(academicTerm.semester);
  }

  async function approveGraduation(id) {
    await onApproveGraduation(id);
    setAdminNotice('Graduation approved. Student status changed to Graduated.');
  }

  return <div className="admin-shell"><aside className="sidebar admin-sidebar"><a className="brand" href="#/admin/dashboard"><span className="brand-icon">g<span>•</span></span><span className="brand-name"><small>BSIT </small>gradeview</span><span className="brand-dot">.</span></a><div className="workspace">ADMIN WORKSPACE</div><nav>{[['dashboard', '▦', 'Dashboard'], ['students', '♙', 'Students'], ['courses', '▤', 'Courses'], ['instructors', '\u2667', 'Instructors'], ['certificates', '\u25a7', 'E-certificates']].map(([id, icon, label]) => <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => changePage(id)} aria-label={label}><span aria-hidden="true">{icon}</span>{label}</button>)}</nav><div className="sidebar-bottom"><div className="help-card"><span className="help-icon">✧</span><h3>Every record tells a story.</h3><p>Help every student see their next step.</p></div><div className="student"><span className="avatar">AD</span><div><strong>Academic administrator</strong><small>{"Administrator"}</small></div></div></div><button className="admin-sidebar-logout secondary-button" onClick={() => { if (canLeaveRecords()) onLogout(); }}>Sign out</button></aside>
  <main className="admin-main"><header><div className="breadcrumb">Admin portal <span>/</span><strong>{({dashboard: 'Dashboard', students: 'Students', courses: 'Courses', instructors: 'Instructors', certificates: 'E-certificates'})[page]}</strong></div><div className="header-right"><span className="portal-status"><i /> {"Connected to database"}</span><button className="secondary-button header-logout" onClick={() => { if (canLeaveRecords()) onLogout(); }}>Sign out</button></div></header>
  <div className="page-heading"><div><div className="eyebrow">ACADEMIC ADMINISTRATION</div><h1>{({dashboard: 'A clearer overview', students: 'Student records', courses: 'Course directory', instructors: 'Instructors', certificates: 'E-certificates'})[page]}<span>.</span></h1><p>{page === 'dashboard' ? 'Support progress. Keep every student in view.' : page === 'students' ? 'Find a student to review and update their grades.' : page === 'certificates' ? 'Create, issue and verify certificates from your department.' : page === 'instructors' ? 'Manage the instructor names available in your course records.' : 'The four-year BSIT curriculum, organized by year and term.'}</p></div><div className="admin-page-actions"><button className="primary-button" disabled={recordsSaving} onClick={() => { if (canLeaveRecords()) setProfileEditor({student:null}); }}>+ Add student</button><span className="admin-term">{academicTermLabel(academicTerm)}</span></div></div>
  {page !== 'certificates' && <AcademicTermPanel term={academicTerm} onSave={onUpdateAcademicTerm} />}
  {page === 'dashboard' && <GraduationQueue students={students} onReview={reviewStudent} onViewAll={() => { if (canLeaveRecords()) { setPage('students'); setSelectedId(null); setFilter('Awaiting graduation approval'); setQuery(''); } }} />}
  {page === 'dashboard' && <><section className="admin-welcome"><div><span className="semester-label">YOUR ACADEMIC WORKSPACE</span><h2>Good records.<br />Better guidance.</h2><p>A little visibility makes a meaningful difference.</p><button onClick={() => changePage('students')}>Review student records <span>→</span></button></div><div className="admin-welcome-art" aria-hidden="true"><span>↗</span><i /><i /><i /><i /></div></section><section className="stats admin-stats">{[['♙', 'blue', 'Students', students.length, 'student profiles'], ['▤', 'purple', 'Curriculum courses', courses.length, 'across four years'], ['✓', 'green', 'Records passed', complete, `of ${records.length} records`], ['◷', 'blue', 'Awaiting completion', pending, 'course records']].map(([icon, tone, label, value, note]) => <article key={label}><span className={`stat-icon ${tone}`}>{icon}</span><div><span className="stat-label">{label}</span><strong>{value} <small>{note}</small></strong></div></article>)}</section><div className="admin-overview-grid"><section className="admin-panel"><div className="admin-section-heading"><div><h2>Curriculum progress</h2><p>Passed course records across all students.</p></div><strong className="completion-number">{percent}%</strong></div><div className="admin-progress-track"><span style={{ width: `${percent}%` }} /></div><div className="panel-export-row"><ExportButton filename="course-progress-summary.pdf" headers={['Course code','Descriptive title','Passed records','Total records','Completion']} rows={progressExportRows} description="course progress summary" /></div><div className="course-progress-list">{courses.slice(0, 4).map(course => { const total = records.filter(record => record.code === course.code); const passed = total.filter(record => record.status === 'Passed').length; return <div key={course.code}><div><strong>{course.code}</strong><span>{passed}/{total.length} passed</span></div><div className="course-progress-track"><span style={{ width: `${total.length ? passed / total.length * 100 : 0}%` }} /></div></div>; })}</div></section><section className="admin-panel"><div className="admin-section-heading"><div><h2>Recent updates</h2><p>{"Recent saved record changes."}</p></div><span className="activity-dot" /></div><div className="panel-export-row"><ExportButton filename="recent-record-updates.pdf" headers={['Student and course','Update']} rows={activity.map(item => [item.text,item.detail])} description="recent updates" /></div>{activity.length ? <ul className="activity-list">{activity.map(item => <li key={item.id}><span className="activity-icon">✓</span><div><strong>{item.text}</strong><small>{item.detail}</small></div></li>)}</ul> : <div className="activity-empty"><span>✧</span><h3>A fresh start</h3><p>{"Saved record edits will appear here."}</p><button className="text-button" onClick={() => changePage('students')}>Review a student →</button></div>}</section></div></>}
  {['dashboard', 'students'].includes(page) && <section className="admin-panel student-directory"><div className="admin-section-heading"><div><h2>{selected ? 'Student progress record' : 'Student directory'} <span className="count-pill">{selected ? selectedCourses.length : students.length}</span></h2><p>{selected ? 'Enter grades in the table, then save a row or all changes.' : 'Select a student to see their courses and grades.'}</p></div><ExportButton filename={selected ? `student-${selected.id}-year-${year}-${semester}.pdf` : 'student-directory.pdf'} headers={selected ? ['Student number','Student name',...courseHeaders] : studentExportHeaders} rows={selected ? courseExportRows(selectedCourses).map(row => [selected.id,selected.name,...row]) : studentExportRows} description={selected ? 'selected student progress records' : 'student directory'} metadata={selected ? [`Current academic term: ${academicTermLabel(academicTerm)}`,`Student: ${selected.name} | Student ID: ${selected.id}`, `Year ${year} | ${semester === "summer" ? "Summer" : "Semester " + semester}`] : [`Current academic term: ${academicTermLabel(academicTerm)}`,`Filter: ${filter}`, ...(query.trim() ? [`Search: ${query.trim().slice(0,200)}`] : [])]} />{selected && <button className="secondary-button" disabled={recordsSaving} onClick={() => { if (canLeaveRecords()) setSelectedId(null); }}>← All students</button>}</div>
  {!selected ? <><div className="directory-toolbar"><label className="admin-search"><span aria-hidden="true">⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name, student number, or program" aria-label="Search students" /></label><select value={filter} onChange={event => setFilter(event.target.value)} aria-label="Filter students"><option>All students</option><option>With pending records</option><option>Awaiting graduation approval</option><option>Transferees</option><option>Active</option><option>Inactive</option><option>Graduated</option></select></div><div className="student-list">{filtered.length ? filtered.map(student => { const summary = studentSummary(student); return <article className="student-list-row" key={student.id}><div className="directory-student"><span className="avatar">{student.name.split(' ').map(name => name[0]).join('')}</span><div><h3>{student.name}</h3><small>{student.id} · Year {student.year}</small></div></div><span className="directory-program">{student.program}<small className={`student-status-label ${(student.studentStatus || "Active").toLowerCase()}`}>{student.studentStatus || "Active"}</small>{student.isTransferee && <small className="transferee-label">Transferee ? {student.previousSchool}</small>}</span><div className="directory-average"><span>GWA</span><strong>{summary.average}</strong></div><span className={`badge ${summary.pending ? 'in-progress' : summary.complete === student.courses.length ? 'passed' : 'not-taken'}`}>{student.studentStatus !== 'Graduated' && graduationState(student).eligible ? 'Awaiting graduation approval' : summary.pending ? `${summary.pending} pending` : summary.complete === student.courses.length ? 'Completed' : 'Not started'}</span><button className="secondary-button" onClick={() => { setSelectedId(student.id); setPage('students'); setYear(String(student.year)); setSemester(academicTerm.semester); }}>View record <span aria-hidden="true">→</span></button></article>; }) : <p className="empty" role="status">No students match your search.</p>}</div><div className="directory-footer">Showing {filtered.length} of {students.length} students</div></> : <><div className="selected-student-summary"><div><h3>{selected.name}</h3><p>{selected.id} · {selected.program}</p>{selected.isTransferee && <span className="transferee-label">Transferee / {selected.previousSchool}</span>}</div><div className="student-summary-actions"><span className={`student-status-label ${(selected.studentStatus || "Active").toLowerCase()}`}>{selected.studentStatus || "Active"}</span><span className="admin-term">Year {selected.year} | GWA {studentSummary(selected).average}</span><button className="secondary-button" disabled={recordsSaving} onClick={() => setProfileEditor({student:selected})}>Edit student details</button><button className="secondary-button" disabled={recordsSaving} onClick={() => setPasswordReset(selected)}>Reset password</button></div></div>{adminNotice && <p className="admin-action-notice" role="status">{adminNotice}</p>}<GraduationNotice student={selected} onApprove={() => setGraduationReview(selected)} disabled={recordsSaving} unsaved={hasUnsavedRecords} /><StudentRetakes courses={selected.courses} disabled={recordsSaving} onSelect={course => { setYear(String(course.year)); setSemester(course.semester); }} /><CurriculumFilters year={year} semester={semester} onYearChange={setYear} onSemesterChange={setSemester} disabled={recordsSaving} /><RecordTable key={selected.id} student={selected} visibleCourses={selectedCourses} academicTerm={academicTerm} instructors={instructors} onStartRetake={onStartRetake} onAddInstructor={() => setInstructorEditor(true)} onSave={onUpdateRecord} onDirtyChange={setHasUnsavedRecords} onBusyChange={setRecordsSaving} /></>}
  </section>}
  {page === 'courses' && <section className="admin-panel"><div className="admin-section-heading"><div><h2>Curriculum courses <span className="count-pill">{termCourses.length}</span></h2><p>Course titles, instructors, and assigned students.</p></div><ExportButton filename={`curriculum-year-${year}-${semester}.pdf`} headers={['Year','Term','Course code','Descriptive title','Instructor','Units','Prerequisite / OJT requirement','Students assigned']} rows={courseExportRows(termCourses).map(row => [...row.slice(0,6),row[8],students.length])} description="course directory" metadata={[`Year ${year} | ${semester === "summer" ? "Summer" : "Semester " + semester}`, "BSIT curriculum revised 2023 | Effective AY 2023-2024"]} /></div><CurriculumFilters year={year} semester={semester} onYearChange={setYear} onSemesterChange={setSemester} /><div className="admin-record-grid">{termCourses.map(course => <article key={course.code} className="admin-record-card"><div className="course-card-heading"><strong className="course-card-code">{course.code}</strong><span className="admin-course-units">{course.units} units</span></div><h3>{course.title}</h3><p><span>Instructor</span>{course.instructor}</p><p><span>{course.sourceRequirementColumn === "Labhours" ? "OJT requirement (source: Labhours)" : "Prerequisite"}</span>{course.prerequisite}</p><div className="admin-course-enrollment">{students.length} students assigned <span>{course.category}</span></div></article>)}</div></section>}
  {page === 'instructors' && <InstructorManager instructors={instructors} students={students} onAdd={() => setInstructorEditor(true)} />}
  {page === 'certificates' && <Suspense fallback={<div className="admin-panel empty" role="status">Loading certificates…</div>}><CertificateManager students={students} /></Suspense>}
  <div className="admin-record-note"><span>{"BSIT gradeview academic records"}</span><span>{"Changes are saved to the database."}</span></div><footer><a className="footer-brand" href="#/admin/dashboard">BSIT gradeview.</a><span>A little clarity for your academic journey.</span><span>{"Administrator portal"}</span></footer></main>
  {profileEditor && <StudentEditor student={profileEditor.student} onSave={saveStudent} onClose={() => setProfileEditor(null)} />}
  {instructorEditor && <InstructorDialog onSave={onCreateInstructor} onClose={() => setInstructorEditor(false)} />}
  {passwordReset && <ResetStudentPasswordDialog student={passwordReset} onReset={resetPassword} onClose={() => setPasswordReset(null)} />}
  {graduationReview && <GraduationApprovalDialog student={students.find(student => student.id === graduationReview.id) || graduationReview} onApprove={approveGraduation} onClose={() => setGraduationReview(null)} />}
  </div>;
}
