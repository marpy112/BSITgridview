import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createClient} from '@libsql/client';
import {compare} from 'bcryptjs';
import {mapSourceCourse,interpretSourceGrade,prepareQuickenrollImport} from '../scripts/quickenroll-data.mjs';
import {applyQuickenrollImport} from '../scripts/import-quickenroll.mjs';
import {inspectSource} from '../scripts/turso-transfer.mjs';
import {wrapTursoClient} from '../server/turso-database.js';
import worker from '../server/worker.js';

const subject=(code,title,grade,removal='')=>({scheduleCode:'1001',subjectCode:code,title,units:'3.0',instructor:'Test Instructor',finalGrade:grade,removalGrade:removal});
const enrollment=(id,year,courses)=>({studentNo:'5260001',sourceEnrollmentId:id,schoolYear:year,semester:'1st',yearLevel:'2',firstName:'Test',lastName:'Student',middleName:'',courses});
function source(enrollments){return {format:'gradeview-quickenroll-v1',source:'quickenroll_ibacmi',students:[{sourceStudentId:'5260001',studentNo:'5260001',firstName:'Test',middleName:'',lastName:'Student',yearLevel:'2',currentlyEnrolled:true}],enrollments,expectedCounts:{students:1,enrollments:enrollments.length,subjectRecords:enrollments.reduce((n,e)=>n+e.courses.length,0)}};}
async function fixture(){
  const client=createClient({url:':memory:'});
  for(const file of (await fs.readdir('migrations')).filter(f=>f.endsWith('.sql')).sort())await client.executeMultiple(await fs.readFile('migrations/'+file,'utf8'));
  await client.execute("INSERT INTO accounts(id,identifier,role,password_hash) VALUES('admin','admin@example.test','admin','unchanged-existing-hash')");
  return client;
}

test('legacy subject codes are mapped by their reviewed titles and units',()=>{
  assert.equal(mapSourceCourse(subject('IT 16','Advanced Database Systems','1.75')),'IT 22');
  assert.equal(mapSourceCourse(subject('IT 20','Capstone Project and Research 1','2.00')),'IT 26');
  assert.equal(mapSourceCourse(subject('GEC CORE 7','Art Appreciation','2.00')),'GE CORE 6');
  assert.equal(mapSourceCourse(subject('IT 30','Capstone Project and Research 3','2.00')),null);
  assert.equal(mapSourceCourse(subject('PE 2','Folk and Latin Dance','2.00')),null);
  assert.equal(mapSourceCourse({...subject('IT 01','Introduction to Computing','2.00'),units:'1.0'}),null);
});

test('removals supersede final grades, and incomplete, dropped, zero and precise grades stay distinct',()=>{
  assert.deepEqual(interpretSourceGrade('INC','2.25'),{grade:2.25,status:'Passed'});
  assert.deepEqual(interpretSourceGrade('1.78'),{grade:1.78,status:'Passed'});
  assert.deepEqual(interpretSourceGrade('INC'),{grade:null,status:'Incomplete'});
  assert.equal(interpretSourceGrade('0').review,'zero_grade_placeholder');
  assert.equal(interpretSourceGrade('DRP').status,undefined);
  assert.equal(interpretSourceGrade('6').status,undefined);
});

test('import preserves accounts, saved grades and full history; records and failed retakes are atomic and repeatable',async()=>{
  const client=await fixture();
  const dir=await fs.mkdtemp(path.resolve('.local/quickenroll-test-'));
  try{
    await client.executeMultiple("INSERT INTO students(student_no,name,year_level,last_name) VALUES('5260001','Existing Student',2,'Student'); INSERT INTO accounts(id,identifier,role,password_hash,student_no) VALUES('existing','5260001','student','keep-student-hash','5260001'); INSERT INTO progress_records(student_no,course_code) SELECT '5260001',code FROM courses; UPDATE progress_records SET grade=1.25,status='Passed',version=3 WHERE course_code='IT 01';");
    const data=source([enrollment('1','2024-2025',[subject('IT 03','IT Fundamentals','5'),subject('IT 01','Introduction to Computing','2.5')]),enrollment('2','2025-2026',[subject('IT 03','IT Fundamentals','1.78')])]);
    const result=await applyQuickenrollImport(client,data,{backupFile:path.join(dir,'before.json'),reviewFile:path.join(dir,'review.json'),hashCost:4});
    assert.equal(result.reviews.existing_saved_record,1);
    assert.equal((await client.execute("SELECT grade FROM progress_records WHERE course_code='IT 01'")).rows[0].grade,1.25);
    assert.equal((await client.execute("SELECT grade,attempt_no FROM progress_records WHERE course_code='IT 03'")).rows[0].grade,1.78);
    assert.equal((await client.execute('SELECT grade FROM course_attempts')).rows[0].grade,5);
    assert.equal((await client.execute("SELECT password_hash FROM accounts WHERE id='existing'")).rows[0].password_hash,'keep-student-hash');
    assert.equal((await client.execute('SELECT count(*) AS n FROM enrollment_source_records')).rows[0].n,3);
    const second=await applyQuickenrollImport(client,data,{backupFile:path.join(dir,'before-again.json'),reviewFile:path.join(dir,'review-again.json'),hashCost:4});
    assert.equal(second.records,0);
    assert.equal((await client.execute('SELECT count(*) AS n FROM course_attempts')).rows[0].n,1);
    assert.equal((await client.execute('SELECT count(*) AS n FROM record_audit')).rows[0].n,1);
  }finally{client.close();}
});

test('new accounts require a surname login change and duplicate source identities are rejected',async()=>{
  const client=await fixture();
  const dir=await fs.mkdtemp(path.resolve('.local/quickenroll-test-'));
  try{
    const data=source([enrollment('1','2026-2027',[subject('IT 03','IT Fundamentals','INC')])]);
    const before=await inspectSource(client);
    const duplicate=source([data.enrollments[0],data.enrollments[0]]);
    assert.throws(()=>prepareQuickenrollImport(duplicate,before),/duplicate enrollment/);
    await applyQuickenrollImport(client,data,{backupFile:path.join(dir,'before.json'),reviewFile:path.join(dir,'review.json'),hashCost:4});
    const account=(await client.execute("SELECT * FROM accounts WHERE student_no='5260001'")).rows[0];
    assert.equal(account.must_change_password,1);
    assert(await compare('Student',account.password_hash));
    assert.equal((await client.execute('SELECT count(*) AS n FROM progress_records')).rows[0].n,68);
  }finally{client.close();}
});

test('a rejected database write rolls back profiles, accounts, history, grades and audits',async()=>{
  const client=await fixture();
  const dir=await fs.mkdtemp(path.resolve('.local/quickenroll-test-'));
  try{
    await client.execute("CREATE TRIGGER reject_import BEFORE INSERT ON record_audit BEGIN SELECT RAISE(ABORT,'rejected import'); END");
    const data=source([enrollment('1','2026-2027',[subject('IT 03','IT Fundamentals','2')])]);
    await assert.rejects(applyQuickenrollImport(client,data,{backupFile:path.join(dir,'before.json'),reviewFile:path.join(dir,'review.json'),hashCost:4}));
    for(const table of ['students','progress_records','course_attempts','enrollment_source_records','record_audit'])assert.equal((await client.execute('SELECT count(*) AS n FROM '+table)).rows[0].n,0,table);
    assert.equal((await client.execute('SELECT count(*) AS n FROM accounts')).rows[0].n,1);
  }finally{client.close();}
});

test('student snapshots preserve all curriculum defaults while reading only saved records',async()=>{
  const client=await fixture();
  try{
    await client.executeMultiple("INSERT INTO students(student_no,name,year_level) VALUES('5260001','Test Student',2); INSERT INTO progress_records(student_no,course_code) SELECT '5260001',code FROM courses; UPDATE progress_records SET instructor='Assigned Instructor' WHERE course_code='IT 01'; UPDATE progress_records SET status='Incomplete',version=2 WHERE course_code='IT 03';");
    const token='a'.repeat(64);
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(b=>b.toString(16).padStart(2,'0')).join('');
    await client.execute({sql:'INSERT INTO sessions(token_hash,account_id,expires_at) VALUES(?,?,?)',args:[digest,'admin',Math.floor(Date.now()/1000)+600]});
    const db=wrapTursoClient(client);
    const prepare=db.prepare;
    let rowsRead=0;
    db.prepare=(...args)=>{const statement=prepare(...args);if(args[0].includes('FROM progress_records')){const all=statement.all;statement.all=async()=>{const result=await all.call(statement);rowsRead+=result.results.length;return result;};}return statement;};
    const response=await worker.fetch(new Request('https://example.test/api/session',{headers:{Cookie:`gradeview_session=${token}`}}),{DB:db});
    assert.equal(response.status,200);
    const snapshot=await response.json();
    assert.equal(snapshot.students[0].courses.length,68);
    assert.equal(rowsRead,2);
    const courses=new Map(snapshot.students[0].courses.map(c=>[c.code,c]));
    assert.equal(courses.get('IT 01').instructor,'Assigned Instructor');
    assert.equal(courses.get('IT 03').status,'Incomplete');
    assert.equal(courses.get('IT 03').recordVersion,2);
    assert.equal(courses.get('IT 02').grade,null);
    assert.equal(courses.get('IT 02').status,'Not taken');
  }finally{client.close();}
});
