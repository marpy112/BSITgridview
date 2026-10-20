import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { hash } from 'bcryptjs';

export function executeLocal(sql) {
  if (process.env.GRADEVIEW_TURSO_TEST_URL) {
    const result = spawnSync(process.execPath, ['tests/helpers/execute-turso.mjs'], { input: sql, encoding: 'utf8', env: process.env, windowsHide: true });
    if (result.status !== 0) throw new Error('Isolated Turso fixture query failed.');
    return;
  }
  const file = path.resolve(`.db-account-${crypto.randomUUID()}.sql`);
  try {
    fs.writeFileSync(file,sql);
    const config = process.env.GRADEVIEW_TEST_CONFIG ? ['--config',process.env.GRADEVIEW_TEST_CONFIG] : [];
    const result = spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','bsit-gradeview-db','--local','--file',file,'--json',...config],{encoding:'utf8',env:{...process.env,WRANGLER_LOG_PATH:'.wrangler/logs',WRANGLER_SEND_METRICS:'false'}});
    if(result.status !== 0) throw new Error(result.stderr || result.stdout);
  } finally { fs.rmSync(file,{force:true}); }
}

export async function createFixture() {
  const tag=crypto.randomUUID();
  const studentId=`integration-${tag}`;
  const adminId=`test-admin-${tag}`;
  const studentAccountId=`test-student-${tag}`;
  const adminEmail=`integration-${tag}@example.test`;
  const password=crypto.randomUUID();
  const passwordHash=await hash(password,12);
  executeLocal(`INSERT OR IGNORE INTO instructors(id,name,name_key) VALUES('fixture-test-instructor','Test Instructor','test instructor'),('fixture-database-instructor','Database Test Instructor','database test instructor');
    INSERT INTO students(student_no,name,year_level) VALUES('${studentId}','API INTEGRATION TEST',2);
    INSERT INTO progress_records(student_no,course_code) SELECT '${studentId}',code FROM courses;
    INSERT INTO accounts(id,identifier,role,password_hash) VALUES('${adminId}','${adminEmail}','admin','${passwordHash}');
    INSERT INTO accounts(id,identifier,role,password_hash,student_no) VALUES('${studentAccountId}','${studentId}','student','${passwordHash}','${studentId}');`);
  return {studentId,adminEmail,password,dispose(){
    executeLocal(`DELETE FROM sessions WHERE account_id IN ('${adminId}','${studentAccountId}');
      DELETE FROM admin_events WHERE actor_id IN ('${adminId}','${studentAccountId}');
      DELETE FROM record_audit WHERE actor_id IN ('${adminId}','${studentAccountId}') OR student_no='${studentId}';
      DELETE FROM progress_records WHERE student_no='${studentId}';
      DELETE FROM accounts WHERE id IN ('${adminId}','${studentAccountId}');
      DELETE FROM students WHERE student_no='${studentId}';`);
  }};
}
