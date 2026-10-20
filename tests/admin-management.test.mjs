import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixture,executeLocal } from './helpers/d1-fixture.mjs';
import { nextAcademicTerm } from '../shared/academic.js';

const base=process.env.GRADEVIEW_TEST_URL;
if(!base || !process.env.GRADEVIEW_TEST_CONFIG || !['127.0.0.1','localhost'].includes(new URL(base).hostname))throw new Error('Use npm run test:admin to run against an isolated local test database.');
const call=(route,method='GET',data,cookie,partial=false)=>fetch(base+route,{method,headers:{Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(partial?{'X-Gradeview-Partial':'1'}:{})},...(data?{body:JSON.stringify(data)}:{})});
async function login(role,identifier,password){const r=await call('/api/login','POST',{role,identifier,password});assert.equal(r.status,200,await r.clone().text());return{cookie:r.headers.get('Set-Cookie').split(';')[0],data:await r.json()};}

test('term sequence moves first to second semester then first semester of the next school year',()=>{
  const first={schoolYearStart:2026,semester:'1',version:0};
  const second=nextAcademicTerm(first);assert.deepEqual(second,{schoolYearStart:2026,semester:'2',version:1});
  assert.deepEqual(nextAcademicTerm(second),{schoolYearStart:2027,semester:'1',version:2});
});

test('admins create students, change year/status, manage grades, and roll terms forward without losing records',async()=>{
  const fixture=await createFixture();
  const id=`TEST-${Date.now()}`;
  const studentInput={id,firstName:'Test',middleName:'',lastName:'TEST SURNAME',year:1,studentStatus:'Active',email:''};
  try{
    const admin=await login('admin',fixture.adminEmail,fixture.password);
    const student=await login('student',fixture.studentId,fixture.password);
    const cookie=admin.cookie;
    assert.equal((await call('/api/students','POST',studentInput,student.cookie)).status,403);
    assert.equal((await call(`/api/students/${fixture.studentId}`,'PATCH',{year:3,studentStatus:'Inactive',email:''},student.cookie)).status,403);
    assert.equal((await call('/api/academic-term','POST',{expectedVersion:0},student.cookie)).status,403);
    assert.equal((await call('/api/students','POST',{...studentInput,year:5},cookie)).status,400);
    const created=await call('/api/students','POST',studentInput,cookie,true);assert.equal(created.status,201,await created.clone().text());
    const initial=await created.json();assert.equal(initial.createdStudentId,id);assert.equal(initial.partialStudents,true);assert.equal(initial.students.length,1);let profile=initial.students.find(s=>s.id===id);assert.equal(profile.courses.length,68);assert.equal(profile.year,1);assert.equal(profile.studentStatus,'Active');
    assert.equal((await call('/api/students','POST',studentInput,cookie)).status,409);
    const firstLogin=await login('student',id,'TEST SURNAME');assert.equal(firstLogin.data.mustChangePassword,true);
    const profileUpdate=await call(`/api/students/${id}`,'PATCH',{year:3,studentStatus:'Inactive',email:'student@example.test'},cookie,true);assert.equal(profileUpdate.status,200);const partial=await profileUpdate.json();assert.equal(partial.partialStudents,true);assert.equal(partial.students.length,1);profile=partial.students.find(s=>s.id===id);assert.equal(profile.year,3);assert.equal(profile.studentStatus,'Inactive');
    assert.equal((await login('student',id,'TEST SURNAME')).data.mustChangePassword,true,'profile edits preserve the initial password and change requirement');
    const endpoint=`/api/students/${id}/records/IT%2012`;
    const grade={grade:1.5,status:'Passed',instructor:'Test Instructor',academicYearTaken:'2026–2027',semesterTaken:'1'};
    assert.equal((await call(endpoint,'PATCH',grade,cookie)).status,200);
    assert.equal((await call(endpoint,'PATCH',{...grade,grade:4},cookie)).status,400);
    let update=await call(endpoint,'PATCH',{...grade,grade:4,status:'Failed'},cookie);assert.equal(update.status,200);assert.equal((await update.json()).students.find(s=>s.id===id).courses.find(c=>c.code==='IT 12').status,'Failed');
    assert.equal((await call(endpoint,'PATCH',{grade:null,status:'Incomplete',instructor:'Test Instructor',academicYearTaken:'2026–2027',semesterTaken:'1'},cookie)).status,200);
    assert.equal((await call(endpoint,'PATCH',grade,cookie)).status,200);
    let snapshot=await(await call('/api/session','GET',null,cookie)).json();
    if(snapshot.academicTerm.schoolYearStart!==2026||snapshot.academicTerm.semester!=='1'){const r=await call('/api/academic-term','PATCH',{schoolYearStart:2026,semester:'1',expectedVersion:snapshot.academicTerm.version},cookie);assert.equal(r.status,200);snapshot=await r.json();}
    const expectedVersion=snapshot.academicTerm.version;
    const second=await call('/api/academic-term','POST',{expectedVersion},cookie);assert.equal(second.status,200);snapshot=await second.json();assert.equal(snapshot.academicTerm.semester,'2');assert.equal(snapshot.academicTerm.schoolYearStart,2026);
    assert.equal((await call('/api/academic-term','POST',{expectedVersion},cookie)).status,409,'stale or repeated requests cannot skip a term');
    const newYear=await call('/api/academic-term','POST',{expectedVersion:snapshot.academicTerm.version},cookie);assert.equal(newYear.status,200);snapshot=await newYear.json();assert.equal(snapshot.academicTerm.semester,'1');assert.equal(snapshot.academicTerm.schoolYearStart,2027);
    profile=snapshot.students.find(s=>s.id===id);assert.equal(profile.year,3,'term changes do not promote students automatically');const preserved=profile.courses.find(c=>c.code==='IT 12');assert.equal(preserved.grade,1.5);assert.equal(preserved.academicYearTaken,'2026–2027');assert.equal(preserved.semesterTaken,'1');
    assert(snapshot.activity.some(event=>event.text==='Academic term advanced'));
    const refreshed=await(await call('/api/session','GET',null,cookie)).json();assert.equal(refreshed.academicTerm.schoolYearStart,2027);
    const own=await(await call('/api/session','GET',null,student.cookie)).json();assert.equal(own.academicTerm.schoolYearStart,2027);
    assert.equal((await call(`/api/students/${id}`,'PATCH',{year:4,studentStatus:'Graduated',email:''},cookie)).status,200);
  }finally{
    executeLocal(`DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE student_no='${id}');DELETE FROM record_audit WHERE student_no='${id}';DELETE FROM progress_records WHERE student_no='${id}';DELETE FROM accounts WHERE student_no='${id}';DELETE FROM students WHERE student_no='${id}';`);
    fixture.dispose();
  }
});
