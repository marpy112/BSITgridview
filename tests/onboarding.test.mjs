import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { hash } from 'bcryptjs';
import { parseMasterList } from '../scripts/import-students.mjs';

const base = process.env.GRADEVIEW_TEST_URL || 'http://127.0.0.1:8787';
if (!['127.0.0.1','localhost'].includes(new URL(base).hostname)) throw new Error('Onboarding tests run only against local D1.');
const id = '90909090';
const name = 'ONBOARDING TEST STUDENT';
function execute(sql) {
  if (process.env.GRADEVIEW_TURSO_TEST_URL) {
    const result = spawnSync(process.execPath, ['tests/helpers/execute-turso.mjs'], { input: sql, encoding: 'utf8', windowsHide: true,
      env: { ...process.env, GRADEVIEW_TEST_QUERY: /^\s*SELECT\b/i.test(sql) ? '1' : '0' } });
    assert.equal(result.status, 0, 'Isolated Turso onboarding fixture failed.');
    return JSON.parse(result.stdout || '[]');
  }
  const file = path.resolve(`.db-account-${crypto.randomUUID()}.sql`);
  try {
    fs.writeFileSync(file,sql);
    const config = process.env.GRADEVIEW_TEST_CONFIG ? ['--config',process.env.GRADEVIEW_TEST_CONFIG] : [];
    const result = spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','bsit-gradeview-db','--local','--file',file,'--json',...config],{encoding:'utf8',env:{...process.env,WRANGLER_LOG_PATH:'.wrangler/logs',WRANGLER_SEND_METRICS:'false'}});
    assert.equal(result.status,0,result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  } finally { fs.rmSync(file,{force:true}); }
}
const call = (route, method='GET', data, cookie) => fetch(base + route,{method,headers:{Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(data?{body:JSON.stringify(data)}:{})});
const cookieOf = response => response.headers.get('Set-Cookie').split(';')[0];

test('master-list validation preserves accented and multiword names and long IDs',()=>{
  const input='student_id\tlast_name\tfirst_name\tmiddle_name\tcourse\tyear\n1234567\tDELA CRUZ\tTEST\t\tBSIT\t2\n12345678\tBEÑAS\tTEST TWO\t\tBSIT\t2';
  const rows=parseMasterList(input);
  assert.equal(rows[0].last_name,'DELA CRUZ');assert.equal(rows[1].last_name,'BEÑAS');assert.equal(rows[1].student_id,'12345678');
  assert.throws(()=>parseMasterList(input+'\n1234567\tOTHER\tTEST\t\tBSIT\t2'),/duplicate/);
});

test('first login requires password replacement, revokes old sessions, and persists the new password',async()=>{
  const existing=execute(`SELECT student_no FROM students WHERE student_no='${id}';`);
  assert.equal(existing[0].results.length,0,'Reserved test student ID already exists; refusing to overwrite it.');
  const initialHash=await hash('TEST SURNAME',12);
  execute(`INSERT INTO students(student_no,name,year_level,first_name,last_name) VALUES('${id}','${name}',2,'TEST','TEST SURNAME');
  INSERT INTO accounts(id,identifier,role,password_hash,student_no,must_change_password) VALUES('onboarding-test-account','${id}','student','${initialHash}','${id}',1);
  INSERT INTO progress_records(student_no,course_code) SELECT '${id}',code FROM courses;`);
  try{
    const login=await call('/api/login','POST',{role:'student',identifier:id,password:'TEST SURNAME'});
    assert.equal(login.status,200);const initialCookie=cookieOf(login);const restricted=await login.json();
    assert.equal(restricted.mustChangePassword,true);assert.equal(restricted.students.length,0);
    const restored=await(await call('/api/session','GET',null,initialCookie)).json();assert.equal(restored.mustChangePassword,true);
    const blocked=await call(`/api/students/${id}/records/IT%2012`,'PATCH',{grade:1.5,status:'Passed',instructor:'Test'},initialCookie);assert.equal(blocked.status,403);assert.equal((await blocked.json()).code,'PASSWORD_CHANGE_REQUIRED');
    const second=await call('/api/login','POST',{role:'student',identifier:id,password:'TEST SURNAME'});assert.equal(second.status,200);const secondCookie=cookieOf(second);
    assert.equal((await call('/api/change-password','POST',{newPassword:'short',confirmPassword:'short'},initialCookie)).status,400);
    assert.equal((await call('/api/change-password','POST',{newPassword:'a sufficiently long password',confirmPassword:'different'},initialCookie)).status,400);
    const changed=await call('/api/change-password','POST',{newPassword:'My new student password 2026!',confirmPassword:'My new student password 2026!'},initialCookie);
    assert.equal(changed.status,200);const newCookie=cookieOf(changed);assert.notEqual(newCookie,initialCookie);const unlocked=await changed.json();assert.equal(unlocked.mustChangePassword,false);assert.equal(unlocked.students[0].courses.length,68);
    assert.equal((await call('/api/session','GET',null,initialCookie)).status,401);assert.equal((await call('/api/session','GET',null,secondCookie)).status,401);
    assert.equal((await call('/api/login','POST',{role:'student',identifier:id,password:'TEST SURNAME'})).status,401);
    const fresh=await call('/api/login','POST',{role:'student',identifier:id,password:'My new student password 2026!'});assert.equal(fresh.status,200);assert.equal((await fresh.json()).mustChangePassword,false);
    const flags=execute(`SELECT must_change_password,password_changed_at FROM accounts WHERE id='onboarding-test-account';`)[0].results[0];assert.equal(flags.must_change_password,0);assert(flags.password_changed_at);
  }finally{
    execute(`DELETE FROM sessions WHERE account_id='onboarding-test-account';DELETE FROM progress_records WHERE student_no='${id}';DELETE FROM accounts WHERE id='onboarding-test-account';DELETE FROM students WHERE student_no='${id}' AND name='${name}';`);
  }
});
