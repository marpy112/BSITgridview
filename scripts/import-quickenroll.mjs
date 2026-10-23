import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID, createHash} from 'node:crypto';
import {hash} from 'bcryptjs';
import {createClient} from '@libsql/client';
import {createTursoDatabase} from '../server/turso-database.js';
import {inspectSource} from './turso-transfer.mjs';
import {prepareQuickenrollImport} from './quickenroll-data.mjs';

const readObjects=(snapshot,name)=>{const t=snapshot.tables.find(t=>t.name===name);return t?t.rows.map(r=>Object.fromEntries(t.columns.map((c,i)=>[c,r[i]]))):[];};
const schoolYear=value=>value.replace('-', '\u2013');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bulk=(table,columns,rows,suffix='')=>{
  const size=Math.max(1,Math.floor(800/columns.length));
  const statements=[];
  for(let i=0;i<rows.length;i+=size){const group=rows.slice(i,i+size);statements.push({sql:`INSERT INTO ${table}(${columns.join(',')}) VALUES ${group.map(()=>`(${columns.map(()=>'?').join(',')})`).join(',')} ${suffix}`,args:group.flat()});}
  return statements;
};

export async function applyQuickenrollImport(client,source,{backupFile,reviewFile,hashCost=12,log=()=>{}}={}){
  if(!backupFile||!reviewFile)throw new Error('Private backup and review file paths are required.');
  const initial=await inspectSource(client);
  const initialPlan=prepareQuickenrollImport(source,initial);
  const passwords=new Map();
  for(const [index,student] of initialPlan.newStudents.entries()){
    passwords.set(student.studentNo,await hash(student.lastName.trim().normalize('NFC'),hashCost));
    if((index+1)%25===0)log(`Prepared ${index+1}/${initialPlan.newStudents.length} new student accounts.`);
  }
  const tx=await client.transaction('write');
  try{
    const before=await inspectSource(tx);
    const plan=prepareQuickenrollImport(source,before);
    if(plan.newStudents.some(s=>!passwords.has(s.studentNo)))throw new Error('Student list changed during preparation. Run the import again.');
    // Take the final backup under the same write lock used for the import.
    await fs.writeFile(backupFile,JSON.stringify(before),{mode:0o600,flag:'wx'});
    await fs.writeFile(reviewFile,JSON.stringify({summary:plan.summary,reviews:plan.reviews},null,2),{mode:0o600,flag:'wx'});
    const runId=randomUUID();
    const actor=readObjects(before,'accounts').find(a=>a.role==='admin');
    if(!actor)throw new Error('An administrator must exist before importing records.');
    const destinationCourses=readObjects(before,'courses');
    const expectedCourses=JSON.parse(await fs.readFile(new URL('../src/curriculum.json',import.meta.url),'utf8'));
    if(destinationCourses.length!==expectedCourses.length||expectedCourses.some(c=>!destinationCourses.some(d=>d.code===c.code&&d.units===c.units)))throw new Error('Destination curriculum differs from the reviewed curriculum.');
    const existingArchive=before.tables.some(t=>t.name==='enrollment_source_records');
    if(!existingArchive)await tx.executeMultiple(await fs.readFile(new URL('../migrations/0010_enrollment_source_records.sql',import.meta.url),'utf8'));
    const statements=[];
    const existingStudentIds=new Set(readObjects(before,'students').map(s=>s.student_no));
    statements.push(...bulk('students',['student_no','name','year_level','first_name','middle_name','last_name','status','is_transferee'],plan.students.map(s=>[s.studentNo,[s.firstName,s.middleName,s.lastName].filter(Boolean).join(' ').normalize('NFC'),s.year,s.firstName.normalize('NFC'),(s.middleName||'').normalize('NFC'),s.lastName.normalize('NFC'),s.status,s.enrollmentType==='Transferee'?1:0]),"ON CONFLICT(student_no) DO UPDATE SET name=excluded.name,year_level=excluded.year_level,first_name=excluded.first_name,middle_name=excluded.middle_name,last_name=excluded.last_name,status=CASE WHEN students.status='Graduated' AND excluded.status='Inactive' THEN students.status ELSE excluded.status END"));
    // Never reset an existing account, password, first-login flag, or transfer data.
    statements.push(...bulk('accounts',['id','identifier','role','password_hash','student_no','must_change_password'],plan.newStudents.map(s=>[randomUUID(),s.studentNo,'student',passwords.get(s.studentNo),s.studentNo,1]),'ON CONFLICT(role,identifier) DO NOTHING'));
    for(let i=0;i<plan.students.length;i+=500){const ids=plan.students.slice(i,i+500).map(s=>s.studentNo);statements.push({sql:`INSERT INTO progress_records(student_no,course_code) SELECT s.student_no,c.code FROM students s CROSS JOIN courses c WHERE s.student_no IN (${ids.map(()=>'?').join(',')}) ON CONFLICT(student_no,course_code) DO NOTHING`,args:ids});}
    const existingInstructors=new Set(readObjects(before,'instructors').map(i=>i.name_key));
    const newInstructors=plan.instructors.filter(i=>!existingInstructors.has(i.key));
    statements.push(...bulk('instructors',['id','name','name_key'],newInstructors.map(i=>[randomUUID(),i.name,i.key]),'ON CONFLICT(name_key) DO NOTHING'));
    statements.push(...bulk('enrollment_source_records',['source','record_type','source_record_id','student_no','payload_json'],plan.archive.map(r=>[source.source,r.type,r.id,r.studentNo,JSON.stringify(r.payload)]),'ON CONFLICT(source,record_type,source_record_id) DO UPDATE SET student_no=excluded.student_no,payload_json=excluded.payload_json,imported_at=CURRENT_TIMESTAMP'));
    statements.push(...bulk('progress_records',['student_no','course_code','grade','status','instructor','academic_year_taken','semester_taken','attempt_no','version','operation_id'],plan.records.map(r=>[r.studentNo,r.courseCode,r.grade,r.status,r.instructor,schoolYear(r.schoolYear),r.semester,r.attemptNo,r.expectedVersion+1,runId]),'ON CONFLICT(student_no,course_code) DO UPDATE SET grade=excluded.grade,status=excluded.status,instructor=excluded.instructor,academic_year_taken=excluded.academic_year_taken,semester_taken=excluded.semester_taken,attempt_no=excluded.attempt_no,version=excluded.version,operation_id=excluded.operation_id,updated_at=CURRENT_TIMESTAMP WHERE progress_records.version=excluded.version-1 AND progress_records.status=\'Not taken\' AND progress_records.grade IS NULL AND progress_records.attempt_no=1 AND progress_records.transfer_school=\'\''));
    statements.push(...bulk('course_attempts',['student_no','course_code','attempt_no','grade','status','instructor','academic_year_taken','semester_taken','archived_by'],plan.attempts.map(r=>[r.studentNo,r.courseCode,r.attemptNo,r.grade,r.status,r.instructor,schoolYear(r.schoolYear),r.semester,actor.id])));
    statements.push(...bulk('record_audit',['id','actor_id','student_no','course_code','grade','status','instructor','academic_year_taken','semester_taken','attempt_no'],plan.records.map(r=>[randomUUID(),actor.id,r.studentNo,r.courseCode,r.grade,r.status,r.instructor,schoolYear(r.schoolYear),r.semester,r.attemptNo])));
    statements.push({sql:'INSERT INTO admin_events(id,actor_id,action,title,detail) VALUES(?,?,?,?,?)',args:[runId,actor.id,'quickenroll_import','Imported BSIT enrollment records',`${plan.students.length} profiles; ${plan.records.length} curriculum records; complete source history retained.`]});
    if(!existingArchive&&before.tables.some(t=>t.name==='d1_migrations'))statements.push("INSERT INTO d1_migrations(name) VALUES('0010_enrollment_source_records.sql')");
    for(let i=0;i<statements.length;i+=30){await tx.batch(statements.slice(i,i+30));if(i%150===0)log(`Applied ${Math.min(i+30,statements.length)}/${statements.length} import statements inside the transaction.`);}
    const after=await inspectSource(tx);
    const accounts=new Map(readObjects(after,'accounts').map(a=>[a.id,a]));
    for(const account of readObjects(before,'accounts'))if(digest(account)!==digest(accounts.get(account.id)))throw new Error('Existing account changed; rolling back.');
    const expectedKeys=new Set(plan.records.map(r=>r.studentNo+'|'+r.courseCode));
    const savedRecords=new Map(readObjects(after,'progress_records').map(r=>[r.student_no+'|'+r.course_code,r]));
    for(const prior of readObjects(before,'progress_records'))if(!expectedKeys.has(prior.student_no+'|'+prior.course_code)&&digest(prior)!==digest(savedRecords.get(prior.student_no+'|'+prior.course_code)))throw new Error('Unrelated saved grade changed; rolling back.');
    for(const record of plan.records){const saved=savedRecords.get(record.studentNo+'|'+record.courseCode);if(!saved||saved.grade!==record.grade||saved.status!==record.status||saved.instructor!==record.instructor||saved.academic_year_taken!==schoolYear(record.schoolYear)||saved.semester_taken!==record.semester||saved.attempt_no!==record.attemptNo||saved.operation_id!==runId)throw new Error('Imported grade verification failed; rolling back.');}
    const archived=new Map(readObjects(after,'enrollment_source_records').filter(r=>r.source===source.source).map(r=>[r.record_type+'|'+r.source_record_id,r]));
    for(const record of plan.archive)if(archived.get(record.type+'|'+record.id)?.payload_json!==JSON.stringify(record.payload))throw new Error('Source history verification failed; rolling back.');
    const savedStudents=new Map(readObjects(after,'students').map(s=>[s.student_no,s]));
    for(const student of plan.students){const saved=savedStudents.get(student.studentNo);if(!saved||saved.year_level!==student.year||saved.first_name!==student.firstName.normalize('NFC')||saved.last_name!==student.lastName.normalize('NFC'))throw new Error('Student verification failed; rolling back.');if(!existingStudentIds.has(student.studentNo)&&!readObjects(after,'accounts').some(a=>a.student_no===student.studentNo&&a.must_change_password===1))throw new Error('New student account verification failed; rolling back.');}
    const savedAttempts=new Map(readObjects(after,'course_attempts').map(r=>[r.student_no+'|'+r.course_code+'|'+r.attempt_no,r]));
    for(const prior of readObjects(before,'course_attempts'))if(digest(prior)!==digest(savedAttempts.get(prior.student_no+'|'+prior.course_code+'|'+prior.attempt_no)))throw new Error('Existing retake history changed; rolling back.');
    for(const attempt of plan.attempts){const saved=savedAttempts.get(attempt.studentNo+'|'+attempt.courseCode+'|'+attempt.attemptNo);if(!saved||saved.grade!==attempt.grade||saved.instructor!==attempt.instructor||saved.academic_year_taken!==schoolYear(attempt.schoolYear)||saved.semester_taken!==attempt.semester)throw new Error('Retake history verification failed; rolling back.');}
    await tx.commit();
    return {...plan.summary,runId,newInstructors:newInstructors.length,verified:true,counts:Object.fromEntries(after.tables.map(t=>[t.name,t.rows.length]))};
  }catch(error){await tx.rollback();throw error;}finally{tx.close();}
}

async function main(){
  const args=process.argv.slice(2);
  const sourceFile=args[args.indexOf('--source')+1];
  if(!args.includes('--source')||!sourceFile||sourceFile.startsWith('--')||args.includes('--apply')===args.includes('--plan'))throw new Error('Usage: node --env-file=.local/deployment/turso.env scripts/import-quickenroll.mjs --source private/bsit-data.json --plan|--apply');
  const source=JSON.parse(await fs.readFile(sourceFile,'utf8'));
  const checked=await createTursoDatabase(process.env.TURSO_DATABASE_URL,process.env.TURSO_AUTH_TOKEN);checked.close();
  const url=new URL(process.env.TURSO_DATABASE_URL);
  const client=createClient({url:`https://${url.host}`,authToken:process.env.TURSO_AUTH_TOKEN,intMode:'number'});
  try{
    const folder=await fs.mkdtemp(path.resolve('.local/quickenroll-import-'));
    if(args.includes('--plan')){
      const plan=prepareQuickenrollImport(source,await inspectSource(client));
      await fs.writeFile(path.join(folder,'plan.json'),JSON.stringify(plan),{mode:0o600});
      console.log(JSON.stringify(plan.summary));console.log(`Private review: ${folder}`);
    }else{
      const result=await applyQuickenrollImport(client,source,{backupFile:path.join(folder,'before.json'),reviewFile:path.join(folder,'review.json'),log:console.log});
      await fs.writeFile(path.join(folder,'result.json'),JSON.stringify(result,null,2),{mode:0o600});
      console.log(JSON.stringify(result));console.log(`Private backup and review: ${folder}`);
    }
  }finally{client.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error('Enrollment import did not complete:',error.code||error.message?.replace(/https?:\/\/\S+/g,'[private URL]'));process.exitCode=1;});
