import { evaluateDeansList, normalizeSchoolYear, validDeansListTerm } from '../shared/deans-list.js';
import { mapSourceCourse } from '../shared/source-courses.js';

const sourceSemester = { '1st': '1', '2nd': '2', Summer: 'summer', '1': '1', '2': '2', summer: 'summer' };

export function deansEnrollment(row) {
  const data = JSON.parse(row.payload_json);
  const validIdentity = data.studentNo === row.student_no;
  const validSubjects = Array.isArray(data.courses);
  return { studentId: row.student_no, schoolYear: normalizeSchoolYear(data.schoolYear), semester: sourceSemester[data.semester],
    yearLevel: ['1','2','3','4'].includes(String(data.yearLevel)) ? String(data.yearLevel) : '',
    problem: !validIdentity || !validSubjects || !['1','2','3','4'].includes(String(data.yearLevel)),
    subjects: validSubjects ? data.courses.map(course => ({ code: mapSourceCourse(course), title: course.title, units: Number(course.units) })) : [],
  };
}

export async function deansListReport(db, schoolYear, semester) {
  schoolYear = normalizeSchoolYear(schoolYear);
  if (!validDeansListTerm(schoolYear, semester)) throw Object.assign(new Error('Choose a valid school year and semester.'), { status: 400 });
  const hasArchive = Boolean(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='enrollment_source_records'").first());
  const termQuery = 'WHERE REPLACE(REPLACE(academic_year_taken,?,?),?,?)=? AND semester_taken=?';
  const termArgs = ['–','-','—','-',schoolYear,semester];
  const queries = [
    db.prepare('SELECT student_no,name,program,is_transferee FROM students ORDER BY name'),
    db.prepare('SELECT code,title,units,year_level FROM courses'),
    db.prepare(`SELECT student_no,course_code,grade,status,transfer_school FROM progress_records ${termQuery}`).bind(...termArgs),
    db.prepare(`SELECT student_no,course_code,grade,status,transfer_school FROM course_attempts ${termQuery}`).bind(...termArgs),
    ...(hasArchive ? [db.prepare("SELECT student_no,payload_json FROM enrollment_source_records WHERE record_type='enrollment' AND REPLACE(REPLACE(json_extract(payload_json,'$.schoolYear'),?,?),?,?)=? AND json_extract(payload_json,'$.semester') IN (?,?)").bind('–','-','—','-',schoolYear,semester,{'1':'1st','2':'2nd',summer:'Summer'}[semester])] : []),
  ];
  // A single transactional batch keeps roster and grade checks on one snapshot.
  const [students, curriculum, current, attempts, archived] = await db.batch(queries);
  const courses = new Map(curriculum.results.map(course => [course.code, course]));
  const records = [...current.results, ...attempts.results].map(record => ({
    studentId: record.student_no, code: record.course_code, grade: record.grade, status: record.status,
    units: courses.get(record.course_code)?.units, transferSchool: record.transfer_school, schoolYear, semester,
  }));
  return { ...evaluateDeansList({
    students: students.results.map(student => ({ id: student.student_no, name: student.name, program: student.program, isTransferee: Boolean(student.is_transferee) })),
    records, enrollments: (archived?.results || []).map(deansEnrollment), schoolYear, semester,
  }), verifiedAt: new Date().toISOString(), rosterAvailable: hasArchive };
}

export async function adminDeansList(request, db, user, json) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/deans-list') return null;
  if (user.role !== 'admin') return json({ error: 'Administrator access is required.' }, 403);
  if (request.method !== 'GET') return json({ error: 'Use GET to retrieve the Dean’s List.' }, 405, { Allow: 'GET' });
  return json(await deansListReport(db, url.searchParams.get('schoolYear'), url.searchParams.get('semester')));
}
