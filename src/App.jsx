import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { courses, yearLabels, termLabels } from './data.js';
import CurriculumFilters from './CurriculumFilters.jsx';
import ExportButton from './ExportButton.jsx';
import { courseHeaders, courseExportRows, downloadPdf } from './export.js';
import '../style.css';
import { RetakeNote, AttemptHistory, StudentRetakes } from './CourseAttempts.jsx';
import { gradeForAverage } from '../shared/retakes.js';
import { academicTermLabel, academicYearLabel, defaultAcademicTerm } from '../shared/academic.js';
import GraduationNotice from './GraduationNotice.jsx';
import { apiRequest } from './api.js';
import './certificates/student-certificates.css';
import StudentNavigation from './StudentNavigation.jsx';
import './student-navigation.css';
const StudentCertificates = lazy(() => import('./certificates/StudentCertificates.jsx'));

function Stat({icon, tone, label, value, note}) {
 return <article><span className={`stat-icon ${tone}`}>{icon}</span><div><span className="stat-label">{label}</span><strong>{value} <small className={tone === 'purple' ? 'positive' : ''}>{note}</small></strong></div></article>;
}
function CourseRow({course: c, onSelect}) {
 const initials = c.instructor.replace(/^(Dr\.|Prof\.|Coach) /, '').split(' ').map(n => n[0]).join('');
 return <tr><td>{c.code}</td><td className="title">{c.title}<small>{c.category}</small><RetakeNote course={c} /></td><td><span className="instructor"><span className="teacher-avatar">{initials}</span>{c.instructor}</span></td><td className="center">{c.units}</td><td className={`center grade ${c.grade === null ? 'pending' : ''}`}>{c.grade === null ? '\u2014' : c.grade.toFixed(2)}{c.transferSchool && <small className="transfer-school-note">{c.transferSchool}</small>}</td><td><span className={`badge ${c.status.toLowerCase().replace(' ', '-')}`}>{c.status}</span></td><td><button className="details" onClick={() => onSelect(c)} aria-label={`View ${c.title} details`}>{"\u203a"}</button></td></tr>;
}
function CourseCard({ course, onSelect }) {
 return (
  <article className="course-card" aria-label={`${course.code}: ${course.title}`}>
   <div className="course-card-heading">
    <span className="course-card-code">{course.code}</span>
    <span className={`badge ${course.status.toLowerCase().replace(' ', '-')}`}>{course.status}</span>
   </div>
   <h3>{course.title}</h3><RetakeNote course={course} />
   <p className="course-card-instructor"><span>Instructor</span>{course.instructor}</p>{course.transferSchool && <p className="course-card-instructor"><span>Transferred grade from</span>{course.transferSchool}</p>}
   <p className="course-card-prerequisite"><span>{course.sourceRequirementColumn === 'Labhours' ? 'OJT requirement (source: Labhours)' : 'Prerequisite'}</span>{course.prerequisite}</p>
   {course.academicYearTaken && <p className="course-taken-note">{course.academicYearTaken} | {termLabels[course.semesterTaken]}</p>}<div className="course-card-footer">
    <dl className="course-card-metrics">
     <div><dt>Grade</dt><dd>{course.grade === null ? 'Pending' : course.grade.toFixed(2)}</dd></div>
     <div><dt>Units</dt><dd>{course.units}</dd></div>
    </dl>
    <button className="course-card-details" onClick={() => onSelect(course)} aria-label={`View ${course.title} details`}>Details <span aria-hidden="true">→</span></button>
   </div>
  </article>
 );
}
function CourseDialog({course, onClose}) {
 const ref = useRef(null);
 useEffect(() => { const dialog = ref.current; dialog.showModal(); return () => dialog.close(); }, []);
 return <dialog ref={ref} onCancel={event => {event.preventDefault(); onClose();}} aria-labelledby="detail-title"><button className="close icon-button" onClick={onClose} aria-label="Close course details">&times;</button><div className="eyebrow">COURSE DETAILS</div><h2 id="detail-title">{course.title}</h2><dl><dt>Course code</dt><dd>{course.code}</dd><dt>Instructor</dt><dd>{course.instructor}</dd><dt>Academic units</dt><dd>{course.units}</dd><dt>Final grade</dt><dd>{course.grade === null ? 'Not yet available' : course.grade.toFixed(2)}</dd><dt>Status</dt><dd>{course.status}</dd>{course.transferSchool && <><dt>School of origin</dt><dd>{course.transferSchool}</dd></>}<dt>School year taken</dt><dd>{course.academicYearTaken || "Not recorded"}</dd><dt>Term taken</dt><dd>{termLabels[course.semesterTaken] || "Not recorded"}</dd><dt>Curriculum year and term</dt><dd>{yearLabels[course.year]} · {termLabels[course.semester]}</dd><dt>{course.sourceRequirementColumn === 'Labhours' ? 'OJT requirement (source: Labhours)' : 'Prerequisite'}</dt><dd>{course.prerequisite}</dd></dl><RetakeNote course={course} /><AttemptHistory course={course} /><p className="dialog-note">Curriculum from the supplied BSIT progress record, revised 2023. {"Student results are saved in the database."}</p></dialog>;
}
export default function App({ currentCourses = courses, onLogout, student, academicTerm=defaultAcademicTerm }) {
 const [page,setPage] = useState('progress');
 const [semester,setSemester] = useState(academicTerm.semester);
 const [year,setYear] = useState(String(student.year));
 const [filter,setFilter] = useState('All');
 const [query,setQuery] = useState('');
 const [sort,setSort] = useState('asc');
 const [dark,setDark] = useState(false);
 const [selected,setSelected] = useState(null);
 const [toast,setToast] = useState('');
 const [exporting,setExporting] = useState(false);
 const [certificateSummary, setCertificateSummary] = useState(null);
 const searchRef = useRef(null);
 useEffect(() => {
  let active = true, refreshing = false, refreshedAt = 0;
  setCertificateSummary(null);
  async function refresh(force = false) {
   if (refreshing || (!force && (document.visibilityState === 'hidden' || Date.now() - refreshedAt < 60000))) return;
   refreshing = true;
   try { const data = await apiRequest('/api/my/certificates/summary'); if (active) { setCertificateSummary(data.summary); refreshedAt = Date.now(); } }
   catch { /* The certificate tab provides a retry when the service is unavailable. */ }
   finally { refreshing = false; }
  }
  const onFocus = () => refresh();
  refresh(true);
  window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onFocus);
  return () => { active = false; window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
 }, [student.id]);
 useEffect(() => setSemester(academicTerm.semester),[academicTerm.semester,academicTerm.schoolYearStart]);
 useEffect(() => setYear(String(student.year)),[student.year]);
 useEffect(() => {document.body.classList.toggle('dark',dark); return () => document.body.classList.remove('dark');}, [dark]);
 useEffect(() => {if(!toast) return; const timer = setTimeout(() => setToast(''),3000); return () => clearTimeout(timer);},[toast]);
 useEffect(() => {const handler = event => {if(event.key === '/' && !['INPUT','SELECT','TEXTAREA'].includes(event.target.tagName) && !['profile', 'certificates'].includes(page) && !selected){event.preventDefault(); searchRef.current?.focus();}}; document.addEventListener('keydown',handler); return () => document.removeEventListener('keydown',handler);},[page,selected]);
 const data = currentCourses.filter(course => course.year === Number(year) && course.semester === semester);
 const passed = data.filter(course => course.status === 'Passed');
 const units = data.reduce((sum,course) => sum + course.units,0);
 const earned = passed.reduce((sum,course) => sum + course.units,0);
 const percent = units ? Math.round(earned / units * 100) : 0;
 const graded = data.filter(course => gradeForAverage(course) !== null);
 const gradedUnits = graded.reduce((sum,course) => sum + course.units, 0);
 const average = gradedUnits ? graded.reduce((sum,course) => sum + gradeForAverage(course) * course.units,0) / gradedUnits : 0;
 const rows = data.filter(course => (filter === 'All' || course.status === filter) && [course.code,course.title,course.instructor].some(value => value.toLowerCase().includes(query.toLowerCase().trim()))).sort((a,b) => sort === 'asc' ? a.code.localeCompare(b.code) : b.code.localeCompare(a.code));
 const pageTitle = {progress:'Progress record',courses:'My courses',profile:'Student profile',certificates:'My certificates'}[page];
 const totalUnits = currentCourses.reduce((sum,course) => sum + course.units, 0);
 const totalEarned = currentCourses.filter(course => course.status === 'Passed').reduce((sum,course) => sum + course.units, 0);
 const exportMetadata = [`Student: ${student.name} | Student ID: ${student.id}`, `Current academic term: ${academicTermLabel(academicTerm)}`, `${yearLabels[year]} | ${termLabels[semester]} | Status: ${filter}`, ...(query.trim() ? [`Search: ${query.trim().slice(0,200)}`] : [])];
 async function exportRecord(){
  setExporting(true);
  try {
   await downloadPdf(`student-${student.id}-year-${year}-${semester}.pdf`, courseHeaders, courseExportRows(rows), { title: 'Student progress record', metadata: exportMetadata });
   setToast('Your progress record PDF has been exported.');
  } catch { setToast('PDF export could not start. Please try again.'); }
  finally { setExporting(false); }
 }
 function navigateStudentPage(nextPage) { setPage(nextPage); window.scrollTo({ top: 0 }); }
 return <>
<aside className="sidebar student-sidebar"><a className="brand" href="#"><span className="brand-icon">g<span>•</span></span><span className="brand-name"><small>BSIT </small>gradeview</span><span className="brand-dot">.</span></a><div className="workspace">STUDENT WORKSPACE</div><StudentNavigation page={page} onNavigate={navigateStudentPage} certificateSummary={certificateSummary} /><div className="sidebar-bottom"><div className="help-card"><span className="help-icon">✧</span><h3>A little progress, every day.</h3><p>Your next milestone is closer than you think.</p><div className="mini-line"></div></div><div className="student"><span className="avatar">{student.name.split(" ").map(name => name[0]).join("").slice(0,2)}</span><div><strong>{student.name}</strong><small>{student.program}</small>{certificateSummary?.valid > 0 && <span className="student-certificate-account-badge">Certificate holder &middot; {certificateSummary.valid}</span>}</div><span className="online"></span></div></div></aside>
<main className="student-main"><header><div className="breadcrumb">Student portal <span>/</span> <strong id="breadcrumb">{pageTitle}</strong></div><div className="header-right"><button className="secondary-button student-signout" onClick={onLogout}>Sign out</button><span className="portal-status"><i></i> {"Connected to database"}</span><button id="theme" className="icon-button" onClick={() => setDark(!dark)} aria-label={dark ? "Use light theme" : "Use dark theme"}>{dark ? "\u2600" : "\u263e"}</button></div></header>
<section id="progress-page" hidden={page === "profile" || page === "certificates"}><div className="page-heading"><div><div className="eyebrow">YOUR ACADEMIC JOURNEY</div><h1>{pageTitle}<span>.</span></h1><p>Your complete BSIT curriculum, organized by year and term.</p></div><button className="export-button" id="export" onClick={exportRecord} disabled={!rows.length || exporting} aria-busy={exporting} title={rows.length ? "Export displayed records as PDF" : "No records to export"}><span>↓</span> {exporting ? "Preparing PDF..." : "Export PDF"}</button></div>
<div className="student-current-term"><div><span>CURRENT ACADEMIC TERM</span><strong>{academicTermLabel(academicTerm)}</strong></div><span className={`student-status-label ${(student.studentStatus || "Active").toLowerCase()}`}>{student.studentStatus || "Active"}</span></div><GraduationNotice student={student} /><section className="hero"><div className="hero-copy"><span className="semester-label"><i></i> CURRICULUM REVISED 2023</span><h2>Small steps.<br />Brighter futures.</h2><p>Keep learning, keep growing. Every completed<br className="desktop" /> course brings you closer to your goals.</p><span className="hero-tag">{student.program} <span>•</span> Year {student.year}</span></div><div className="hero-art" aria-hidden="true"><div className="orbit orbit-one"></div><div className="orbit orbit-two"></div><span className="star star-one">✧</span><span className="star star-two">✦</span><div className="glass-card rear"></div><div className="glass-card front"><div className="art-icon">✓</div><div className="art-line"></div><div className="art-line short"></div><div className="bars"><i></i><i></i><i></i><i></i><i></i></div></div><div className="floating-pill"><span>↗</span> A little better every day</div></div></section>
<section className="curriculum-summary"><div><div className="eyebrow">BSIT CURRICULUM REVISED 2023</div><h2>First year to fourth year</h2><p>Effective AY 2023–2024 · {currentCourses.length} courses · {totalUnits} total units</p></div><div className="curriculum-earned"><strong>{totalEarned}<span> / {totalUnits}</span></strong><small>curriculum units earned</small></div><div className="curriculum-export"><ExportButton filename="curriculum-year-summary.pdf" headers={['Year','Courses','Total units','Earned units']} rows={Object.entries(yearLabels).map(([value,label]) => {const items=currentCourses.filter(course=>course.year===Number(value)); return [label,items.length,items.reduce((sum,course)=>sum+course.units,0),items.filter(course=>course.status==='Passed').reduce((sum,course)=>sum+course.units,0)];})} description="curriculum year summary" metadata={[`Student: ${student.name} | Student ID: ${student.id}`, "BSIT curriculum revised 2023 | Effective AY 2023-2024"]} /></div><div className="curriculum-year-shortcuts">{Object.entries(yearLabels).map(([value, label]) => { const yearCourses = currentCourses.filter(course => course.year === Number(value)); return <button key={value} aria-pressed={year === value} className={year === value ? 'selected' : ''} onClick={() => { setYear(value); if (value !== '1' && semester === 'summer') setSemester('1'); }}><strong>{label}</strong><small>{yearCourses.length} courses · {yearCourses.reduce((sum, course) => sum + course.units, 0)} units</small></button>; })}</div></section><section className="stats">
<Stat icon="▤" tone="blue" label="Curriculum courses" value={data.length} note="in selected term" />
<Stat icon="✓" tone="green" label="Completed courses" value={passed.length} note={`of ${data.length} courses`} />
<Stat icon="✧" tone="purple" label="General weighted average" value={gradedUnits ? average.toFixed(2) : "\u2014"} note={!gradedUnits ? "No grades yet" : average <= 1.75 ? "Very good" : average <= 3 ? "Passing" : "Needs attention"} />
<article><div className="progress-ring" style={{background:`conic-gradient(#5782df ${percent}%,#eef2fa 0)`}}><span>{percent}%</span></div><div><span className="stat-label">Semester progress</span><strong>{earned} <small>of {units} units earned</small></strong></div></article>
</section><StudentRetakes courses={currentCourses} onSelect={setSelected} /><section className="record-panel"><div className="panel-heading"><div><h2>Your courses <span id="course-count">{data.length}</span></h2><p>Your grades and course standing at a glance.</p></div><div className="table-heading-actions"><CurriculumFilters year={year} semester={semester} onYearChange={setYear} onSemesterChange={setSemester} /><ExportButton filename={`student-${student.id}-year-${year}-${semester}.pdf`} headers={courseHeaders} rows={courseExportRows(rows)} description="student course records" metadata={exportMetadata} /></div></div><div className="toolbar"><div className="tabs" aria-label="Filter courses">{['All','Passed','In progress','Incomplete','Not taken','Failed'].map(status => <button key={status} className={filter === status ? 'selected' : ''} onClick={() => setFilter(status)} aria-pressed={filter === status}>{status === 'All' ? <>All courses <span>{data.length}</span></> : status}</button>)}</div><label className="search"><span>⌕</span><input id="search" ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search courses or instructors…" aria-label="Search courses or instructors" /><kbd>/</kbd></label></div><div className="table-scroll"><table><thead><tr><th aria-sort={sort === "asc" ? "ascending" : "descending"}><button id="sort" onClick={() => setSort(sort === "asc" ? "desc" : "asc")}>COURSE CODE <span>{sort === "desc" ? "\u2193" : "\u2191"}</span></button></th><th>DESCRIPTIVE TITLE</th><th>INSTRUCTOR</th><th className="center">UNITS</th><th className="center">GRADE</th><th>STATUS</th><th></th></tr></thead><tbody id="course-rows">{rows.length ? rows.map(course => <CourseRow key={course.code} course={course} onSelect={setSelected} />) : <tr><td colSpan="7" className="empty">No matching courses. Try another search or status.</td></tr>}</tbody></table></div><div className="mobile-course-list"><div className="mobile-course-sort"><span>Course records</span><button onClick={() => setSort(sort === 'asc' ? 'desc' : 'asc')}>Code: {sort === 'asc' ? 'A to Z' : 'Z to A'}</button></div>{rows.length ? rows.map(course => <CourseCard key={course.code} course={course} onSelect={setSelected} />) : <p className="empty" role="status">No matching courses. Try another search or status.</p>}</div><div className="table-footer"><span id="results">Showing {rows.length} of {data.length} courses</span><span><i className="info">i</i> Grades use the 1.00–5.00 scale. 1.00 is the highest.</span></div></section><div className="bottom-note"><span>♧ Your progress is personal. Your potential is limitless.</span><span>For reference only · Unofficial student record</span></div></section>
<section id="profile-page" hidden={page !== "profile"}><div className="page-heading"><div><div className="eyebrow">YOUR STUDENT INFORMATION</div><h1>Student profile<span>.</span></h1><p>Your academic details in one place.</p></div></div><GraduationNotice student={student} /><article className="profile-card"><span className="avatar large">{student.name.split(" ").map(name => name[0]).join("").slice(0,2)}</span><h2>{student.name}</h2><p>{student.program}</p>{certificateSummary?.valid > 0 && <button type="button" className="student-certificate-holder-badge" onClick={() => setPage("certificates")}><span aria-hidden="true">{"\u2726"}</span> Certificate holder <small>{certificateSummary.valid} verified</small></button>}<dl><dt>Student number</dt><dd>{student.id}</dd><dt>Year level</dt><dd>Year {student.year}</dd><dt>Department</dt><dd>College of Computer Studies</dd><dt>Current school year</dt><dd>{academicYearLabel(academicTerm)}</dd><dt>Student status</dt><dd>{student.studentStatus || "Active"}</dd><dt>Student type</dt><dd>{student.isTransferee ? "Transferee" : "Regular student"}</dd>{student.isTransferee && <><dt>Previous school</dt><dd>{student.previousSchool}</dd></>}<dt>Email</dt><dd>{student.email || "Not provided"}</dd></dl><span className="portal-status">{"Student profile"}</span></article></section>
<section id="certificates-page" hidden={page !== "certificates"}>{page === "certificates" && <Suspense fallback={<p className="student-certificate-loading" role="status">Loading certificates...</p>}><StudentCertificates student={student} summary={certificateSummary} onSummary={setCertificateSummary} /></Suspense>}</section><footer><a className="footer-brand" href="#">BSIT gradeview.</a><span>A little clarity for your academic journey.</span><span>{"Student portal"}</span></footer></main>
{selected && <CourseDialog course={selected} semester={semester} onClose={() => setSelected(null)} />}<div id="toast" className={toast ? 'student-toast visible' : 'student-toast'} role="status">{toast}</div></>;
}
