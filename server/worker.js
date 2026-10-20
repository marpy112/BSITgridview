import { compare, hash as hashPassword } from 'bcryptjs';
import { nextAcademicTerm, academicYearLabel, academicTermLabel } from '../shared/academic.js';
import { validateStudent } from './studentValidation.js';

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

async function body(request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw Object.assign(new Error('Use application/json.'), { status: 415 });
  if (Number(request.headers.get('Content-Length')) > 4096) throw Object.assign(new Error('Request too large.'), { status: 413 });
  const reader = request.body?.getReader();
  const chunks = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4096) { await reader.cancel(); throw Object.assign(new Error('Request too large.'), { status: 413 }); }
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

async function snapshot(db, user) {
  if (user.must_change_password) return { role: user.role, mustChangePassword: true, students: [], activity: [] };
  const term = await readAcademicTerm(db);
  const students = user.role === 'admin'
    ? await db.prepare('SELECT * FROM students ORDER BY name').all()
    : await db.prepare('SELECT * FROM students WHERE student_no=?').bind(user.student_no).all();
  const query = `SELECT r.*, c.title, c.units, c.year_level, c.semester, c.prerequisite, c.source_requirement_column FROM progress_records r JOIN courses c ON c.code=r.course_code`;
  const records = user.role === 'admin'
    ? await db.prepare(`${query} ORDER BY c.sort_order`).all()
    : await db.prepare(`${query} WHERE r.student_no=? ORDER BY c.sort_order`).bind(user.student_no).all();
  const yearLabels = { 1: 'First year', 2: 'Second year', 3: 'Third year', 4: 'Fourth year' };
  const terms = { 1: '1st semester', 2: '2nd semester', summer: 'Summer' };
  const profiles = students.results.map(student => ({
    id: student.student_no, name: student.name, year: student.year_level, program: student.program, email: student.email, studentStatus: student.status,
    firstName: student.first_name, middleName: student.middle_name, lastName: student.last_name,
    courses: records.results.filter(record => record.student_no === student.student_no).map(record => ({
      code: record.course_code, title: record.title, units: record.units, year: record.year_level, semester: record.semester,
      prerequisite: record.prerequisite, sourceRequirementColumn: record.source_requirement_column,
      instructor: record.instructor, grade: record.grade, status: record.status,
      academicYearTaken: record.academic_year_taken, semesterTaken: record.semester_taken,
      category: `${yearLabels[record.year_level]} · ${terms[record.semester]}`,
    })),
  }));
  const audit = user.role === 'admin' ? await db.prepare(`SELECT a.*, s.name FROM record_audit a JOIN students s ON s.student_no=a.student_no ORDER BY a.created_at DESC, a.rowid DESC LIMIT 5`).all() : { results: [] };
  const events = user.role === 'admin' ? await db.prepare('SELECT * FROM admin_events ORDER BY created_at DESC,rowid DESC LIMIT 5').all() : { results: [] };
  const activity = [
    ...events.results.map(item => ({ id: item.id, text: item.title, detail: item.detail, createdAt: item.created_at })),
    ...audit.results.map(item => ({ id: item.id, text: `${item.name} · ${item.course_code}`, detail: `Updated to ${item.status}${item.grade !== null ? ` · Grade ${item.grade.toFixed(2)}` : ''}`, createdAt: item.created_at })),
  ].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,5);
  return { role: user.role, mustChangePassword: false, students: profiles, activity, academicTerm: term,
    ...(user.role === 'admin' ? { instructors: await listInstructors(db) } : {}) };
}

async function readAcademicTerm(db) {
  const row = await db.prepare('SELECT * FROM academic_calendar WHERE id=1').first();
  return { schoolYearStart: row.school_year_start, semester: row.semester, version: row.version };
}

async function api(request, env) {
  const url = new URL(request.url);
  const db = env.DB;
  if (!db) return json({ error: 'Database binding is not configured.' }, 503);
  if (url.pathname === '/api/health' && request.method === 'GET') {
    try {
      const row = await db.prepare('SELECT version FROM academic_calendar WHERE id=1').first();
      if (!row) throw new Error();
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
    return json({ ...await snapshot(db, user), passwordResetStudentId: studentNo });
  }
  if (url.pathname === '/api/students' && request.method === 'POST') {
    if (user.role !== 'admin') return json({ error: 'Administrator access is required.' }, 403);
    const input = await body(request);
    const error = validateStudent(input);
    if (error) return json({ error },400);
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
        db.prepare('INSERT INTO students(student_no,name,year_level,email,first_name,middle_name,last_name,status) VALUES(?,?,?,?,?,?,?,?)').bind(studentNo,name,input.year,input.email.trim(),first,middle,last,input.studentStatus),
        db.prepare('INSERT INTO accounts(id,identifier,role,password_hash,student_no,must_change_password) VALUES(?,?,\'student\',?,?,1)').bind(crypto.randomUUID(),studentNo.toLowerCase(),passwordHash,studentNo),
        db.prepare('INSERT INTO progress_records(student_no,course_code) SELECT ?,code FROM courses').bind(studentNo),
        db.prepare('INSERT INTO admin_events(id,actor_id,action,title,detail) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),user.id,'student.created',`Student added: ${name}`,`${studentNo} · Year ${input.year} · ${input.studentStatus}`),
      ]);
    } catch (error) {
      if (/unique constraint/i.test(error.message)) return json({ error: 'That student ID already exists.' },409);
      throw error;
    }
    return json({ ...await snapshot(db,user), createdStudentId: studentNo },201);
  }
  const profileMatch = url.pathname.match(/^\/api\/students\/([^/]+)$/);
  if (profileMatch && request.method === 'PATCH') {
    if (user.role !== 'admin') return json({ error: 'Administrator access is required.' },403);
    const studentNo = decodeURIComponent(profileMatch[1]);
    const input = await body(request);
    const error = validateStudent(input,true);
    if (error) return json({ error },400);
    const student = await db.prepare('SELECT name FROM students WHERE student_no=?').bind(studentNo).first();
    if (!student) return json({ error: 'Student not found.' },404);
    await db.batch([
      db.prepare('UPDATE students SET year_level=?,status=?,email=? WHERE student_no=?').bind(input.year,input.studentStatus,input.email.trim(),studentNo),
      db.prepare('INSERT INTO admin_events(id,actor_id,action,title,detail) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),user.id,'student.updated',`Student updated: ${student.name}`,`Year ${input.year} · ${input.studentStatus}`),
    ]);
    return json(await snapshot(db,user));
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
  const match = url.pathname.match(/^\/api\/students\/([^/]+)\/records\/([^/]+)$/);
  if (match && request.method === 'PATCH') {
    if (user.role !== 'admin') return json({ error: 'Administrator access is required.' }, 403);
    const studentNo = decodeURIComponent(match[1]);
    const code = decodeURIComponent(match[2]);
    const input = await body(request);
    const error = validateUpdate(input);
    if (error) return json({ error }, 400);
    const record = await db.prepare('SELECT * FROM progress_records WHERE student_no=? AND course_code=?').bind(studentNo, code).first();
    if (!record) return json({ error: 'Student course record not found.' }, 404);
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
    await db.batch([
      db.prepare('UPDATE progress_records SET grade=?,status=?,instructor=?,academic_year_taken=?,semester_taken=?,updated_at=CURRENT_TIMESTAMP WHERE student_no=? AND course_code=?').bind(input.grade, input.status, instructor,yearTaken,semesterTaken,studentNo, code),
      db.prepare('INSERT INTO record_audit(id,actor_id,student_no,course_code,grade,status,instructor,academic_year_taken,semester_taken) VALUES(?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(), user.id, studentNo, code, input.grade, input.status, instructor,yearTaken,semesterTaken),
    ]);
    return json(await snapshot(db, user));
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
    catch (error) { const requestId = crypto.randomUUID(); console.error(JSON.stringify({ event: 'api_error', requestId, method: request.method, status: error.status || 500 })); response = json({ error: error.status ? error.message : 'The request failed. Please try again.', requestId }, error.status || 500); }
    if (new URL(request.url).protocol === 'https:') response.headers.set('Strict-Transport-Security', 'max-age=31536000');
    return response;
  },
};
