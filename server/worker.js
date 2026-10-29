import { compare, hash as hashPassword } from 'bcryptjs';
import { nextAcademicTerm, academicYearLabel, academicTermLabel } from '../shared/academic.js';
import { validateStudent } from './studentValidation.js';
import { normalizeSchoolAcronym, validSchoolAcronym } from '../shared/transfer.js';
import { nextRetakeTerm, retakeLabel } from '../shared/retakes.js';
import { dailyDatabaseLimit, isDailyDatabaseLimit } from './database-errors.js';
import { graduationProgress } from '../shared/graduation.js';
import { publicCertificate, adminCertificates } from './certificates.js';
import { studentCertificates } from './student-certificates.js';
import { databaseReady } from './readiness.js';

const COOKIE = 'gradeview_session';
const SESSION_SECONDS = 60 * 60 * 8;
const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", ...headers } });
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const instructorKey = name => name.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

async function listInstructors(db) {
  return (await db.prepare('SELECT id,name FROM instructors ORDER BY name COLLATE NOCASE').all()).results;
}

function cookie(request, token, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

async function body(request, limit = 4096) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw Object.assign(new Error('Use application/json.'), { status: 415 });
  if (Number(request.headers.get('Content-Length')) > limit) throw Object.assign(new Error('Request too large.'), { status: 413 });
  const reader = request.body?.getReader();
  const chunks = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) { await reader.cancel(); throw Object.assign(new Error('Request too large.'), { status: 413 }); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error();
    return input;
  } catch { throw Object.assign(new Error('Send a valid JSON object.'), { status: 400 }); }
}

export function validateUpdate(input) {
  const { grade, status, instructor } = input || {};
  if (!['Not taken', 'In progress', 'Incomplete', 'Passed', 'Failed'].includes(status)) return 'Invalid course status.';
  if (typeof instructor !== 'string' || instructor.trim().length > 120) return 'Instructor must be text of up to 120 characters.';
  if (['Passed', 'Failed'].includes(status)) {
    if (typeof grade !== 'number' || !Number.isFinite(grade) || grade < 1 || grade > 5 || Math.abs(grade * 100 - Math.round(grade * 100)) > 0.00001) return 'Enter a grade between 1.00 and 5.00, with up to two decimal places.';
    if (status === 'Passed' && grade > 3) return 'A passing grade must be 3.00 or better.';
    if (status === 'Failed' && grade <= 3) return 'A failed grade must be above 3.00.';
  } else if (grade !== null) return 'Pending and untaken courses must have no final grade.';
  return '';
}

async function session(request, db) {
  const token = request.headers.get('Cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return db.prepare(`SELECT a.id, a.role, a.student_no, a.must_change_password FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?`).bind(await digest(token), Math.floor(Date.now() / 1000)).first();
}

async function snapshot(db, user, studentNo) {
  if (user.must_change_password) return { role: user.role, mustChangePassword: true, students: [], activity: [] };
  const term = await readAcademicTerm(db);
  const scopedStudent = user.role === 'admin' ? studentNo : user.student_no;
  const students = !scopedStudent
    ? await db.prepare('SELECT * FROM students ORDER BY name').all()
    : await db.prepare('SELECT * FROM students WHERE student_no=?').bind(scopedStudent).all();
  // Read the curriculum once instead of joining it to every student's record.
  const curriculum = new Map((await db.prepare('SELECT * FROM courses ORDER BY sort_order').all()).results.map(course => [course.code, course]));
  // Blank curriculum rows contain no student-specific information. Reconstruct
  // those defaults locally instead of transferring them from the database.
  const savedRecord = "(grade IS NOT NULL OR status<>'Not taken' OR instructor<>'Unassigned' OR academic_year_taken<>'' OR semester_taken<>'' OR transfer_school<>'' OR attempt_no<>1 OR version<>0)";
  const records = !scopedStudent
    ? await db.prepare(`SELECT * FROM progress_records WHERE ${savedRecord}`).all()
    : await db.prepare(`SELECT * FROM progress_records WHERE student_no=? AND ${savedRecord}`).bind(scopedStudent).all();
  const savedRecords = new Map(records.results.map(record => [`${record.student_no}\0${record.course_code}`, record]));
  const attempts = !scopedStudent
    ? await db.prepare('SELECT * FROM course_attempts ORDER BY attempt_no').all()
    : await db.prepare('SELECT * FROM course_attempts WHERE student_no=? ORDER BY attempt_no').bind(scopedStudent).all();
  const histories = new Map();
  for (const attempt of attempts.results) {
    const key = `${attempt.student_no}\0${attempt.course_code}`;
    if (!histories.has(key)) histories.set(key, []);
    histories.get(key).push({ attemptNumber: attempt.attempt_no, grade: attempt.grade, status: attempt.status,
      instructor: attempt.instructor, academicYearTaken: attempt.academic_year_taken, semesterTaken: attempt.semester_taken, transferSchool: attempt.transfer_school });
  }
  const yearLabels = { 1: 'First year', 2: 'Second year', 3: 'Third year', 4: 'Fourth year' };
  const terms = { 1: '1st semester', 2: '2nd semester', summer: 'Summer' };
  const profiles = students.results.map(student => ({
    id: student.student_no, name: student.name, year: student.year_level, program: student.program, email: student.email, studentStatus: student.status,
    firstName: student.first_name, middleName: student.middle_name, lastName: student.last_name,
    graduationApprovedAt: student.graduation_approved_at || null,
    isTransferee: Boolean(student.is_transferee), previousSchool: student.previous_school,
    courses: [...curriculum.values()].map(course => {
      const saved = savedRecords.get(`${student.student_no}\0${course.code}`) || {
        course_code: course.code, grade: null, status: 'Not taken', instructor: 'Unassigned',
        academic_year_taken: '', semester_taken: '', transfer_school: '', attempt_no: 1, version: 0,
      };
      const record = { ...curriculum.get(saved.course_code), ...saved };
      return ({
      code: record.course_code, title: record.title, units: record.units, year: record.year_level, semester: record.semester,
      prerequisite: record.prerequisite, sourceRequirementColumn: record.source_requirement_column,
      instructor: record.instructor, grade: record.grade, status: record.status,
      academicYearTaken: record.academic_year_taken, semesterTaken: record.semester_taken,
      transferSchool: record.transfer_school,
      ...(record.attempt_no > 1 ? { attemptNumber: record.attempt_no } : {}),
      ...(record.version ? { recordVersion: record.version } : {}),
      ...(record.status === 'Failed' ? { retake: nextRetakeTerm(record.academic_year_taken, record.semester_taken) } : {}),
      ...(histories.has(`${student.student_no}\0${record.course_code}`) ? { pastAttempts: histories.get(`${student.student_no}\0${record.course_code}`) } : {}),
      category: `${yearLabels[record.year_level]} · ${terms[record.semester]}`,
    }); }),
  }));
  for (const profile of profiles) profile.graduation = graduationProgress(profile.courses, [...curriculum.keys()]);
  const audit = user.role === 'admin' ? await db.prepare(`SELECT a.*, s.name FROM record_audit a JOIN students s ON s.student_no=a.student_no ORDER BY a.created_at DESC, a.rowid DESC LIMIT 5`).all() : { results: [] };
  const events = user.role === 'admin' ? await db.prepare('SELECT * FROM admin_events ORDER BY created_at DESC,rowid DESC LIMIT 5').all() : { results: [] };
  const activity = [
    ...events.results.map(item => ({ id: item.id, text: item.title, detail: item.detail, createdAt: item.created_at })),
    ...audit.results.map(item => ({ id: item.id, text: `${item.name} · ${item.course_code}`, detail: `Updated to ${item.status}${item.grade !== null ? ` · Grade ${item.grade.toFixed(2)}` : ''}`, createdAt: item.created_at })),
  ].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,5);
  return { role: user.role, mustChangePassword: false, students: profiles, activity, academicTerm: term,
    ...(user.role === 'admin' && scopedStudent ? { partialStudents: true } : {}),
    ...(user.role === 'admin' ? { instructors: await listInstructors(db) } : {}) };
}

function mutationSnapshot(request, db, user, studentNo) {
  return snapshot(db, user, request.headers.get('X-Gradeview-Partial') === '1' ? studentNo : undefined);
}

async function readAcademicTerm(db) {
  const row = await db.prepare('SELECT * FROM academic_calendar WHERE id=1').first();
  return { schoolYearStart: row.school_year_start, semester: row.semester, version: row.version };
}

async function api(request, env) {
  const url = new URL(request.url);
  const db = env.DB;
  if (!db) return json({ error: 'Database binding is not configured.' }, 503);
  if (url.pathname.startsWith('/api/certificates/verify/')) {
    return await publicCertificate(request, db, json) || json({ error: 'Certificate not found. Check the certificate link.' }, 404);
  }
  if (url.pathname === '/api/health' && request.method === 'GET') {
    try {
      if (!await databaseReady(db)) throw new Error();
      return json({ status: 'ok' });
    } catch { return json({ status: 'unavailable' }, 503); }
  }
  const origin = request.headers.get('Origin');
  const allowedOrigin = env.APP_ORIGIN;
  if (!['GET', 'HEAD'].includes(request.method) && origin !== url.origin && (!allowedOrigin || origin !== allowedOrigin)) return json({ error: 'Request origin is not allowed.' }, 403);
  if (url.pathname === '/api/login' && request.method === 'POST') {
    const input = await body(request);
    if (!['student', 'admin'].includes(input?.role) || typeof input.identifier !== 'string' || input.identifier.length > 150 || typeof input.password !== 'string' || new TextEncoder().encode(input.password).length > 72) return json({ error: 'Invalid login details.' }, 400);
    const identifier = input.identifier.trim().toLowerCase();
    const now = Math.floor(Date.now() / 1000);
    const bucket = Math.floor(now / 900);
    const keys = await Promise.all([`ip:${request.headers.get('CF-Connecting-IP') || 'local'}:${bucket}`, `account:${input.role}:${identifier}:${bucket}`].map(digest));
    const limits = await db.batch(keys.map(key => db.prepare('INSERT INTO login_attempts(bucket_key,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(bucket_key) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(key, now + 1800)));
    if (limits[0].results[0].attempts > 50 || limits[1].results[0].attempts > 10) return json({ error: 'Too many sign-in attempts. Try again in 15 minutes.' }, 429, { 'Retry-After': String(900 - now % 900) });
    const account = await db.prepare('SELECT * FROM accounts WHERE role=? AND identifier=?').bind(input.role, identifier).first();
    // Use a valid dummy bcrypt hash to avoid revealing whether an account exists by timing.
    const hash = account?.password_hash || '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';
    const matches = await compare(input.password, hash);
    if (!account || !matches) return json({ error: 'Student number/email or password is incorrect.' }, 401);
    const token = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    await db.batch([
      db.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now),
      db.prepare('DELETE FROM login_attempts WHERE expires_at<=?').bind(now),
      db.prepare('INSERT INTO sessions(token_hash,account_id,expires_at) VALUES(?,?,?)').bind(await digest(token), account.id, now + SESSION_SECONDS),
    ]);
    return json(await snapshot(db, account), 200, { 'Set-Cookie': cookie(request, token, SESSION_SECONDS) });
  }
  const user = await session(request, db);
  if (!user) return json({ error: 'Please sign in.' }, 401);
  if (url.pathname === '/api/session' && request.method === 'GET') return json(await snapshot(db, user));
  if (url.pathname === '/api/logout' && request.method === 'POST') {
    const raw = request.headers.get('Cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    if (raw) await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(raw)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, '', 0) });
  }
  if (url.pathname === '/api/change-password' && request.method === 'POST') {
    if (user.role !== 'student' || !user.must_change_password) return json({ error: 'A first-login password change is not required for this account.' }, 400);
    const input = await body(request);
    const password = input?.newPassword;
    if (typeof password !== 'string' || password.length < 12 || new TextEncoder().encode(password).length > 72) return json({ error: 'Use at least 12 characters and no more than 72 UTF-8 bytes.' }, 400);
    if (password !== input.confirmPassword) return json({ error: 'The new passwords do not match.' }, 400);
    const account = await db.prepare('SELECT password_hash FROM accounts WHERE id=?').bind(user.id).first();
    if (await compare(password, account.password_hash)) return json({ error: 'Choose a new password different from your initial password.' }, 400);
    const nextHash = await hashPassword(password, 12);
    const token = [...crypto.getRandomValues(new Uint8Array(32))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const now = Math.floor(Date.now() / 1000);
    const result = await db.batch([
      db.prepare('UPDATE accounts SET password_hash=?,must_change_password=0,password_changed_at=CURRENT_TIMESTAMP WHERE id=? AND must_change_password=1 AND password_hash=?').bind(nextHash,user.id,account.password_hash),
      db.prepare('DELETE FROM sessions WHERE account_id=? AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND password_hash=?)').bind(user.id,user.id,nextHash),
      db.prepare('INSERT INTO sessions(token_hash,account_id,expires_at) SELECT ?,id,? FROM accounts WHERE id=? AND password_hash=?').bind(await digest(token),now + SESSION_SECONDS,user.id,nextHash),
    ]);
    if (result[0].meta.changes !== 1) return json({ error: 'This password has already been changed. Please sign in again.' }, 409);
    return json(await snapshot(db, { ...user, must_change_password: 0 }), 200, { 'Set-Cookie': cookie(request,token,SESSION_SECONDS) });
  }
  if (user.must_change_password) return json({ error: 'Change your initial password before accessing student records.', code: 'PASSWORD_CHANGE_REQUIRED' }, 403);
  const studentCertificateResponse = await studentCertificates(request, db, user, json, env.CERTIFICATE_ORIGIN);
  if (studentCertificateResponse) return studentCertificateResponse;
  const certificateResponse = await adminCertificates(request, env, user, { json, body });
  if (certificateResponse) return certificateResponse;
  if (url.pathname === '/api/instructors' && ['GET', 'POST'].includes(request.method)) {
    if (user.role !== 'admin') return json({ error: 'Administrator access is required.' }, 403);
    if (request.method === 'GET') return json({ instructors: await listInstructors(db) });
    const input = await body(request);
    if (typeof input.name !== 'string' || /[\u0000-\u001f\u007f]/.test(input.name)) return json({ error: 'Enter a valid instructor name.' }, 400);
    const name = input.name.normalize('NFC').replace(/\s+/g, ' ').trim();
    if (!name || name.length > 120 || instructorKey(name) === 'unassigned') return json({ error: 'Enter an instructor name of 1–120 characters. Unassigned is reserved.' }, 400);
    const existing = await listInstructors(db);
    if (existing.some(item => instructorKey(item.name) === instructorKey(name))) return json({ error: 'That instructor is already in the list.' }, 409);
    const id = crypto.randomUUID();
    try {
      await db.batch([
        db.prepare('INSERT INTO instructors(id,name,name_key) VALUES(?,?,?)').bind(id, name, instructorKey(name)),
        db.prepare('INSERT INTO admin_events(id,actor_id,action,title,detail) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(), user.id, 'instructor.created', `Instructor added: ${name}`, 'Available in the course instructor dropdown.'),
      ]);
    } catch (error) {
      if (/unique constraint/i.test(error.message)) return json({ error: 'That instructor is already in the list.' }, 409);
      throw error;
    }
    return json({ ...await snapshot(db, user), createdInstructorId: id }, 201);
  }
  const graduationMatch = url.pathname.match(/^\/api\/students\/([^/]+)\/graduation$/);
  if (graduationMatch && request.method === 'POST') {
    if (user.role !== 'admin') return json({ error: 'Administrator access is required.' }, 403);
    const studentNo = decodeURIComponent(graduationMatch[1]);
    const input = await body(request);
    if (input.confirmStudentId !== studentNo) return json({ error: 'Confirm the student ID before approving graduation.' }, 400);
    const student = await db.prepare('SELECT name,status FROM students WHERE student_no=?').bind(studentNo).first();
    if (!student) return json({ error: 'Student not found.' }, 404);
    if (student.status === 'Graduated') return json({ error: 'This student is already marked Graduated.' }, 409);
    const operationId = crypto.randomUUID();
    // Eligibility and the status change happen in the same write. A missing,
    // pending, or failing required course prevents approval, even after review.
    const result = await db.batch([
      db.prepare(`UPDATE students SET status='Graduated',graduation_approved_at=CURRENT_TIMESTAMP,graduation_approved_by=?,status_operation_id=?
        WHERE student_no=? AND status<>'Graduated' AND EXISTS(SELECT 1 FROM courses)
        AND NOT EXISTS(SELECT 1 FROM courses c LEFT JOIN progress_records r ON r.course_code=c.code AND r.student_no=students.student_no
          WHERE r.student_no IS NULL OR r.status<>'Passed' OR r.grade IS NULL OR r.grade<1 OR r.grade>3)`)
        .bind(user.id, operationId, studentNo),
      db.prepare('INSERT INTO admin_events(id,actor_id,action,title,detail) SELECT ?,?,?,?,? FROM students WHERE student_no=? AND status_operation_id=?')
        .bind(operationId, user.id, 'student.graduation_approved', `Graduation approved: ${student.name}`, `${studentNo} · All required courses passed. Status changed to Graduated.`, studentNo, operationId),
    ]);
    if (result[0].meta.changes !== 1) return json({ error: 'All required courses must have saved passing grades before graduation can be approved. Refresh and review this student.' }, 409);
    return json({ ...await mutationSnapshot(request, db, user, studentNo), graduationApprovedStudentId: studentNo });
  }
  const resetMatch = url.pathname.match(/^\/api\/students\/([^/]+)\/reset-password$/);
  if (resetMatch && request.method === 'POST') {
    if (user.role !== 'admin') return json({ error: 'Administrator access is required.' }, 403);
    const studentNo = decodeURIComponent(resetMatch[1]);
    const input = await body(request);
    if (input.confirmStudentId !== studentNo) return json({ error: 'Confirm the student ID before resetting their password.' }, 400);
    const account = await db.prepare("SELECT a.id,a.identifier,a.password_hash,s.name,s.last_name FROM accounts a JOIN students s ON s.student_no=a.student_no WHERE a.role='student' AND s.student_no=?").bind(studentNo).first();
    if (!account) return json({ error: 'Student login account not found.' }, 404);
    if (!account.last_name.trim() || new TextEncoder().encode(account.last_name).length > 72) return json({ error: 'The student needs a valid saved last name before their password can be reset.' }, 400);
    // Hash the saved surname exactly: preserve case, accents, and spaces.
    const nextHash = await hashPassword(account.last_name, 12);
    const bucket = Math.floor(Date.now() / 1000 / 900);
    const keys = await Promise.all([bucket, bucket - 1].map(value => digest(`account:student:${account.identifier}:${value}`)));
    const result = await db.batch([
      db.prepare("UPDATE accounts SET password_hash=?,must_change_password=1,password_changed_at=NULL WHERE id=? AND role='student' AND password_hash=?").bind(nextHash, account.id, account.password_hash),
      db.prepare('DELETE FROM sessions WHERE account_id=? AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND password_hash=?)').bind(account.id, account.id, nextHash),
      db.prepare('DELETE FROM login_attempts WHERE bucket_key IN (?,?) AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND password_hash=?)').bind(...keys, account.id, nextHash),
      db.prepare('INSERT INTO admin_events(id,actor_id,action,title,detail) SELECT ?,?,?,?,? FROM accounts WHERE id=? AND password_hash=?').bind(crypto.randomUUID(), user.id, 'student.password_reset', `Student password reset: ${account.name}`, `${studentNo} · Password change required at next sign-in.`, account.id, nextHash),
    ]);
    if (result[0].meta.changes !== 1) return json({ error: 'This login changed during the reset. Refresh and try again.' }, 409);
    return json({ ...await mutationSnapshot(request, db, user, studentNo), passwordResetStudentId: studentNo });
  }
  if (url.pathname === '/api/students' && request.method === 'POST') {
    if (user.role !== 'admin') return json({ error: 'Administrator access is required.' }, 403);
    const input = await body(request);
    const error = validateStudent(input);
    if (error) return json({ error },400);
    if (input.studentStatus === 'Graduated') return json({ error: 'Create the student first, then review and approve their completed curriculum for graduation.' }, 400);
    const studentNo = input.id.trim();
    const duplicate = await db.prepare('SELECT student_no AS id FROM students WHERE student_no=? COLLATE NOCASE UNION ALL SELECT identifier FROM accounts WHERE role=\'student\' AND identifier=?').bind(studentNo,studentNo).first();
    if (duplicate) return json({ error: 'That student ID already has a student record or login account.' },409);
    const first = input.firstName.trim().normalize('NFC');
    const middle = input.middleName.trim().normalize('NFC');
    const last = input.lastName.trim().normalize('NFC');
    const name = [first,middle,last].filter(Boolean).join(' ');
    const passwordHash = await hashPassword(last,12);
    try {
      await db.batch([
        db.prepare('INSERT INTO students(student_no,name,year_level,email,first_name,middle_name,last_name,status,is_transferee,previous_school) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(studentNo,name,input.year,input.email.trim(),first,middle,last,input.studentStatus,input.isTransferee ? 1 : 0,input.isTransferee ? normalizeSchoolAcronym(input.previousSchool) : ''),
        db.prepare('INSERT INTO accounts(id,identifier,role,password_hash,student_no,must_change_password) VALUES(?,?,\'student\',?,?,1)').bind(crypto.randomUUID(),studentNo.toLowerCase(),passwordHash,studentNo),
        db.prepare('INSERT INTO progress_records(student_no,course_code) SELECT ?,code FROM courses').bind(studentNo),
        db.prepare('INSERT INTO admin_events(id,actor_id,action,title,detail) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),user.id,'student.created',`Student added: ${name}`,`${studentNo} · Year ${input.year} · ${input.studentStatus}`),
      ]);
    } catch (error) {
      if (/unique constraint/i.test(error.message)) return json({ error: 'That student ID already exists.' },409);
      throw error;
    }
    return json({ ...await mutationSnapshot(request,db,user,studentNo), createdStudentId: studentNo },201);
  }
  const profileMatch = url.pathname.match(/^\/api\/students\/([^/]+)$/);
  if (profileMatch && request.method === 'PATCH') {
    if (user.role !== 'admin') return json({ error: 'Administrator access is required.' },403);
    const studentNo = decodeURIComponent(profileMatch[1]);
    const input = await body(request);
    const error = validateStudent(input,true);
    if (error) return json({ error },400);
    const student = await db.prepare('SELECT name,status,is_transferee,previous_school FROM students WHERE student_no=?').bind(studentNo).first();
    if (!student) return json({ error: 'Student not found.' },404);
    if (input.expectedStudentStatus !== undefined && input.expectedStudentStatus !== student.status) return json({ error: 'This student’s status changed. Refresh their record before saving these details.' }, 409);
    if (input.studentStatus === 'Graduated' && student.status !== 'Graduated') return json({ error: 'Review and approve graduation from the student record before changing their status to Graduated.' }, 409);
    const isTransferee = input.isTransferee ?? Boolean(student.is_transferee);
    const previousSchool = input.previousSchool === undefined ? student.previous_school : normalizeSchoolAcronym(input.previousSchool);
    if (isTransferee && !validSchoolAcronym(previousSchool)) return json({ error: 'Enter the transferee’s previous school acronym.' }, 400);
    if (!isTransferee && student.is_transferee && await db.prepare("SELECT 1 FROM progress_records WHERE student_no=? AND transfer_school<>'' LIMIT 1").bind(studentNo).first()) return json({ error: 'This student has transferred grades. Remove their transferred-school entries before changing the student type.' }, 409);
    const operationId = crypto.randomUUID();
    const result = await db.batch([
      db.prepare("UPDATE students SET year_level=?,status=?,email=?,is_transferee=?,previous_school=?,graduation_approved_at=CASE WHEN ?='Graduated' THEN graduation_approved_at ELSE NULL END,graduation_approved_by=CASE WHEN ?='Graduated' THEN graduation_approved_by ELSE NULL END,status_operation_id=? WHERE student_no=? AND status=?").bind(input.year,input.studentStatus,input.email.trim(),isTransferee ? 1 : 0,isTransferee ? previousSchool : '',input.studentStatus,input.studentStatus,operationId,studentNo,student.status),
      db.prepare('INSERT INTO admin_events(id,actor_id,action,title,detail) SELECT ?,?,?,?,? FROM students WHERE student_no=? AND status_operation_id=?').bind(operationId,user.id,'student.updated',`Student updated: ${student.name}`,`Year ${input.year} · ${input.studentStatus} · ${isTransferee ? `Transferee from ${previousSchool}` : 'Regular student'}`,studentNo,operationId),
    ]);
    if (result[0].meta.changes !== 1) return json({ error: 'This student’s status changed. Refresh their record before saving these details.' }, 409);
    return json(await mutationSnapshot(request,db,user,studentNo));
  }
  if (url.pathname === '/api/academic-term' && ['POST','PATCH'].includes(request.method)) {
    if (user.role !== 'admin') return json({ error: 'Administrator access is required.' },403);
    const input = await body(request);
    const current = await readAcademicTerm(db);
    if (!Number.isInteger(input?.expectedVersion) || input.expectedVersion !== current.version) return json({ error: 'The active term has changed. Refresh and review it before continuing.' },409);
    const next = request.method === 'POST' ? nextAcademicTerm(current) : { schoolYearStart: input.schoolYearStart, semester: input.semester };
    if (!Number.isInteger(next.schoolYearStart) || next.schoolYearStart < 2000 || next.schoolYearStart > 2199 || !['1','2'].includes(next.semester)) return json({ error: 'Choose a valid school year and semester.' },400);
    if (next.schoolYearStart === current.schoolYearStart && next.semester === current.semester) return json(await snapshot(db,user));
    const operationId = crypto.randomUUID();
    const result = await db.batch([
      db.prepare('UPDATE academic_calendar SET school_year_start=?,semester=?,version=version+1,operation_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=1 AND version=?').bind(next.schoolYearStart,next.semester,operationId,current.version),
      db.prepare('INSERT INTO admin_events(id,actor_id,action,title,detail) SELECT ?,?,?,?,? FROM academic_calendar WHERE id=1 AND operation_id=?').bind(operationId,user.id,'term.updated',request.method === 'POST' ? 'Academic term advanced' : 'Academic term corrected',`${academicTermLabel(current)} to ${academicTermLabel(next)}`,operationId),
    ]);
    if (result[0].meta.changes !== 1) return json({ error: 'Another administrator changed the term. Refresh before continuing.' },409);
    return json(await snapshot(db,user));
  }
  const retakeMatch = url.pathname.match(/^\/api\/students\/([^/]+)\/records\/([^/]+)\/retake$/);
  if (retakeMatch && request.method === 'POST') {
    if (user.role !== 'admin') return json({ error: 'Administrator access is required.' }, 403);
    const studentNo = decodeURIComponent(retakeMatch[1]);
    const code = decodeURIComponent(retakeMatch[2]);
    const input = await body(request);
    const record = await db.prepare('SELECT * FROM progress_records WHERE student_no=? AND course_code=?').bind(studentNo, code).first();
    if (!record) return json({ error: 'Student course record not found.' }, 404);
    if (record.status !== 'Failed') return json({ error: 'Only a failed course can start a retake.' }, 409);
    if (input.expectedAttemptNumber !== record.attempt_no || input.expectedRecordVersion !== record.version) return json({ error: 'This course changed. Refresh before starting its retake.' }, 409);
    const next = nextRetakeTerm(record.academic_year_taken, record.semester_taken);
    if (!next) return json({ error: 'Save the failed attempt’s school year and semester before starting a retake.' }, 400);
    const operationId = crypto.randomUUID();
    const result = await db.batch([
      db.prepare("UPDATE progress_records SET attempt_no=attempt_no+1,grade=NULL,status='In progress',instructor='Unassigned',academic_year_taken=?,semester_taken=?,transfer_school='',version=version+1,operation_id=?,updated_at=CURRENT_TIMESTAMP WHERE student_no=? AND course_code=? AND version=? AND status='Failed'").bind(next.schoolYear, next.semester, operationId, studentNo, code, record.version),
      db.prepare('INSERT INTO course_attempts(student_no,course_code,attempt_no,grade,status,instructor,academic_year_taken,semester_taken,transfer_school,archived_by) SELECT ?,?,?,?,?,?,?,?,?,? FROM progress_records WHERE student_no=? AND course_code=? AND operation_id=?').bind(studentNo, code, record.attempt_no, record.grade, record.status, record.instructor, record.academic_year_taken, record.semester_taken, record.transfer_school, user.id, studentNo, code, operationId),
      db.prepare('INSERT INTO admin_events(id,actor_id,action,title,detail) SELECT ?,?,?,?,? FROM progress_records WHERE student_no=? AND course_code=? AND operation_id=?').bind(operationId, user.id, 'course.retake_started', `Retake started: ${code}`, `${studentNo} · Attempt ${record.attempt_no + 1} · ${retakeLabel(next)}. Previous failed grade retained.`, studentNo, code, operationId),
    ]);
    if (result[0].meta.changes !== 1) return json({ error: 'This course changed. Refresh before starting its retake.' }, 409);
    return json(await mutationSnapshot(request, db, user, studentNo));
  }
  const match = url.pathname.match(/^\/api\/students\/([^/]+)\/records\/([^/]+)$/);
  if (match && request.method === 'PATCH') {
    if (user.role !== 'admin') return json({ error: 'Administrator access is required.' }, 403);
    const studentNo = decodeURIComponent(match[1]);
    const code = decodeURIComponent(match[2]);
    const input = await body(request);
    const error = validateUpdate(input);
    if (error) return json({ error }, 400);
    const record = await db.prepare('SELECT r.*,s.is_transferee FROM progress_records r JOIN students s ON s.student_no=r.student_no WHERE r.student_no=? AND r.course_code=?').bind(studentNo, code).first();
    if (!record) return json({ error: 'Student course record not found.' }, 404);
    if ((input.expectedAttemptNumber !== undefined && input.expectedAttemptNumber !== record.attempt_no) ||
        (record.attempt_no > 1 && input.expectedAttemptNumber !== record.attempt_no) ||
        (input.expectedRecordVersion !== undefined && input.expectedRecordVersion !== record.version)) return json({ error: 'This course changed. Reload its saved values before editing.' }, 409);
    if (input.transferSchool !== undefined && typeof input.transferSchool !== 'string') return json({ error: 'Enter a valid school acronym.' }, 400);
    const transferSchool = input.transferSchool === undefined ? record.transfer_school : normalizeSchoolAcronym(input.transferSchool);
    if (transferSchool && (!validSchoolAcronym(transferSchool) || !record.is_transferee || input.grade === null || !['Passed', 'Failed'].includes(input.status))) return json({ error: 'Transferred grades need a transferee student, a final grade, and a school acronym of up to 30 characters.' }, 400);
    let instructor = input.instructor.trim() || 'Unassigned';
    if (instructorKey(instructor) === 'unassigned') instructor = 'Unassigned';
    else {
      const registered = await db.prepare('SELECT name FROM instructors WHERE name=?').bind(instructor).first();
      if (!registered) return json({ error: 'Select a saved instructor, or add the instructor to the list first.' }, 400);
      instructor = registered.name;
    }
    const term = await readAcademicTerm(db);
    const yearTaken = input.status === 'Not taken' ? '' : input.academicYearTaken ?? (record.academic_year_taken || academicYearLabel(term));
    const semesterTaken = input.status === 'Not taken' ? '' : input.semesterTaken ?? (record.semester_taken || term.semester);
    if (input.status !== 'Not taken' && (!/^\d{4}[–-]\d{4}$/.test(yearTaken) || Number(yearTaken.slice(5)) !== Number(yearTaken.slice(0,4)) + 1 || !['1','2','summer'].includes(semesterTaken))) return json({ error: 'Choose a valid school year and semester for this record.' },400);
    if (record.attempt_no > 1 && (yearTaken !== record.academic_year_taken || semesterTaken !== record.semester_taken)) return json({ error: 'A retake must stay in the school year after the failed attempt, in the same semester.' }, 400);
    const operationId = crypto.randomUUID();
    const result = await db.batch([
      db.prepare('UPDATE progress_records SET grade=?,status=?,instructor=?,academic_year_taken=?,semester_taken=?,transfer_school=?,version=version+1,operation_id=?,updated_at=CURRENT_TIMESTAMP WHERE student_no=? AND course_code=? AND version=?').bind(input.grade, input.status, instructor,yearTaken,semesterTaken,transferSchool,operationId,studentNo, code,record.version),
      db.prepare('INSERT INTO record_audit(id,actor_id,student_no,course_code,grade,status,instructor,academic_year_taken,semester_taken,transfer_school,attempt_no) SELECT ?,?,?,?,?,?,?,?,?,?,? FROM progress_records WHERE student_no=? AND course_code=? AND operation_id=?').bind(operationId, user.id, studentNo, code, input.grade, input.status, instructor,yearTaken,semesterTaken,transferSchool,record.attempt_no,studentNo,code,operationId),
    ]);
    if (result[0].meta.changes !== 1) return json({ error: 'This course changed while saving. Reload its saved values and try again.' }, 409);
    return json(await mutationSnapshot(request, db, user, studentNo));
  }
  return json({ error: 'API endpoint not found.' }, 404);
}

export default {
  async scheduled(_event, env) {
    const now = Math.floor(Date.now() / 1000);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now),
      env.DB.prepare('DELETE FROM login_attempts WHERE expires_at<=?').bind(now),
    ]);
  },
  async fetch(request, env) {
    if (!new URL(request.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    let response;
    try { response = await api(request, env); }
    catch (error) {
      if (isDailyDatabaseLimit(error)) error = dailyDatabaseLimit();
      const requestId = crypto.randomUUID();
      console.error(JSON.stringify({ event: 'api_error', requestId, method: request.method, status: error.status || 500, ...(error.code === 'DATABASE_DAILY_LIMIT' ? { code: error.code } : {}) }));
      response = json({ error: error.status ? error.message : 'The request failed. Please try again.', requestId,
        ...(error.code === 'DATABASE_DAILY_LIMIT' ? { code: error.code, retryAt: error.retryAt } : {}),
      }, error.status || 500, error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {});
    }
    if (new URL(request.url).protocol === 'https:') response.headers.set('Strict-Transport-Security', 'max-age=31536000');
    return response;
  },
};
