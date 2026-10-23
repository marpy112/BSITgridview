import curriculum from '../src/curriculum.json' with { type: 'json' };

const normalize = value => String(value).normalize('NFC').toLowerCase().replaceAll('&',' and ').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
const titles = new Map(curriculum.map(c=>[normalize(c.title), c.code]));
const aliases = {
  'readings in phillipine history':'GE CORE 2',
  'reading in the philippine history':'GE CORE 2',
  'the contemporary word':'GE CORE 3',
  'mathematics in modern world':'GE CORE 4',
  'computer program 01':'IT 02',
  'introduction to computer interaction':'IT 05',
  'data structure and algorithm':'IT 07',
  'civic welfare trainingprogram 1':'NSTP 1',
  'civic welfare training and service 1':'NSTP 1',
  'civic welfare training and service 2':'NSTP 2',
  'civic welfare traning service 2':'NSTP 2',
  'pathfit 3 fundamentals of martial arts':'PE 3',
  'fundamentals of martial arts':'PE 3',
  'life and works of rizal':'RIZAL',
  'fundamentals of database systems':'IT 16',
  'systems integration and architecture 1':'IT 17',
  'information assurance and security 1':'IT 19',
  'multimedia systems':'IT 25',
  'school guidance program 6':'SGP 6',
  'ojt practicum':'OJT',
  'practice 486 hours':'OJT',
};
for (const [title,code] of Object.entries(aliases)) titles.set(title,code);
const canonical = new Map(curriculum.map(c=>[c.code,c]));
export const instructorKey = name => name.normalize('NFC').replace(/\s+/g,' ').trim().toLowerCase();

export function mapSourceCourse(course) {
  let code = titles.get(normalize(course.title));
  // The source sometimes omits the SGP number from its title. Its code supplies it.
  if (normalize(course.title)==='school guidance program') {
    const number=/^SGP\s*0?([1-6])$/i.exec(course.subjectCode)?.[1];
    code=number ? `SGP ${number}` : undefined;
  }
  if (!code || Number(course.units)!==canonical.get(code).units) return null;
  return code;
}

export function interpretSourceGrade(finalGrade, removalGrade='') {
  const value=String(removalGrade || finalGrade).trim();
  if (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) {
    const grade=Number(value);
    if (grade>=1 && grade<=5) return {grade,status:grade<=3?'Passed':'Failed'};
    if (grade===0) return {grade:null,status:'In progress',review:'zero_grade_placeholder'};
    return {review:'grade_out_of_range'};
  }
  if(value==='INC') return {grade:null,status:'Incomplete'};
  if(['','NG','TBE'].includes(value)) return {grade:null,status:'In progress',...(value?{review:'pending_grade_marker'}:{})};
  return {review:'unsupported_grade_marker'};
}

function termNumber(entry) {
  const semesters={ '1st':1,'2nd':2,'Summer':3 };
  const year=Number(entry.schoolYear.slice(0,4));
  if(!/^\d{4}-\d{4}$/.test(entry.schoolYear)||Number(entry.schoolYear.slice(5))!==year+1||year<2000||year>=2200||!semesters[entry.semester]) throw new Error('Invalid source academic term.');
  return year*10+semesters[entry.semester];
}
const semesterValue = value => ({'1st':'1','2nd':'2','Summer':'summer'})[value];
const objects = (snapshot,name) => {
  const table=snapshot.tables.find(t=>t.name===name);
  return table ? table.rows.map(row=>Object.fromEntries(table.columns.map((column,index)=>[column,row[index]]))) : [];
};

export function prepareQuickenrollImport(source, snapshot) {
  if(source.format!=='gradeview-quickenroll-v1'||source.source!=='quickenroll_ibacmi'||!Array.isArray(source.students)||!Array.isArray(source.enrollments)) throw new Error('Unsupported source export.');
  const totals={students:source.students.length,enrollments:source.enrollments.length,subjectRecords:source.enrollments.reduce((n,e)=>n+e.courses.length,0)};
  for(const [key,count] of Object.entries(totals)) if(source.expectedCounts?.[key]!==count) throw new Error(`Source count mismatch: ${key}.`);
  const seenStudents=new Set(), seenEnrollments=new Set();
  const reviews=[], students=new Map(), histories=new Map(), instructors=new Map(), archive=[];
  const validId=value=>typeof value==='string'&&/^\d{7,8}$/.test(value);
  for(const s of source.students){
    if(!s.sourceStudentId||seenStudents.has(s.sourceStudentId))throw new Error('Duplicate or missing source student key.');
    seenStudents.add(s.sourceStudentId);
    archive.push({type:'student',id:s.sourceStudentId,studentNo:s.studentNo||'',payload:s});
    if(!validId(s.studentNo)||!['1','2','3','4'].includes(s.yearLevel)){
      reviews.push({reason:!validId(s.studentNo)?'missing_student_id':'missing_year_level',sourceStudentId:s.sourceStudentId,studentNo:s.studentNo});
      continue;
    }
    students.set(s.studentNo,{...s,year:Number(s.yearLevel),status:s.currentlyEnrolled?'Active':'Inactive'});
  }
  const sorted=[...source.enrollments].sort((a,b)=>termNumber(a)-termNumber(b)||Number(a.sourceEnrollmentId)-Number(b.sourceEnrollmentId));
  for(const entry of sorted){
    if(!validId(entry.studentNo)||!/^\d+$/.test(entry.sourceEnrollmentId)||seenEnrollments.has(entry.sourceEnrollmentId)||!['1','2','3','4'].includes(entry.yearLevel))throw new Error('Invalid or duplicate enrollment identity.');
    seenEnrollments.add(entry.sourceEnrollmentId);
    archive.push({type:'enrollment',id:entry.sourceEnrollmentId,studentNo:entry.studentNo,payload:entry});
    if(!students.has(entry.studentNo)) students.set(entry.studentNo,{studentNo:entry.studentNo,firstName:entry.firstName,middleName:entry.middleName,lastName:entry.lastName,year:Number(entry.yearLevel),status:'Inactive',fromEnrollment:true});
    else if(students.get(entry.studentNo).fromEnrollment) Object.assign(students.get(entry.studentNo),{firstName:entry.firstName,middleName:entry.middleName,lastName:entry.lastName,year:Number(entry.yearLevel)});
    for(const [row,course] of entry.courses.entries()){
      if(typeof course.instructor!=='string'||course.instructor.length>120)throw new Error('Invalid source instructor name.');
      const instructor=course.instructor.normalize('NFC').replace(/\s+/g,' ').trim();
      if(instructor&&instructorKey(instructor)!=='unassigned')instructors.set(instructorKey(instructor),instructor);
      const courseCode=mapSourceCourse(course);
      const grade=interpretSourceGrade(course.finalGrade,course.removalGrade);
      const item={studentNo:entry.studentNo,courseCode,sourceEnrollmentId:entry.sourceEnrollmentId,sourceRow:row,subjectCode:course.subjectCode,title:course.title,schoolYear:entry.schoolYear,semester:semesterValue(entry.semester),instructor:instructor||'Unassigned',...grade};
      if(!courseCode||grade.review)reviews.push({...item,reason:!courseCode?'unmapped_subject':grade.review});
      // Retain unsupported latest markers in the history: a later dropped/unknown
      // enrollment must never cause an earlier grade to be promoted as current.
      if(courseCode){const key=entry.studentNo+'|'+courseCode;if(!histories.has(key))histories.set(key,[]);histories.get(key).push(item);}
    }
  }
  for(const s of students.values()) if(!s.firstName?.trim()||!s.lastName?.trim()||s.firstName.length>80||s.lastName.length>80||new TextEncoder().encode(s.lastName.normalize('NFC').trim()).length>72)throw new Error('Invalid source student name.');
  const existingStudents=new Map(objects(snapshot,'students').map(s=>[s.student_no,s]));
  const existingRecords=new Map(objects(snapshot,'progress_records').map(r=>[r.student_no+'|'+r.course_code,r]));
  const existingAttempts=new Set(objects(snapshot,'course_attempts').map(r=>r.student_no+'|'+r.course_code));
  const records=[], attempts=[];
  for(const [key,history] of histories){
    const latest=history.at(-1);
    if(!latest.status)continue;
    const sameTerm=history.filter(r=>r.schoolYear===latest.schoolYear&&r.semester===latest.semester);
    if(sameTerm.some(r=>r.grade!==latest.grade||r.status!==latest.status)){
      reviews.push({...latest,reason:'conflicting_source_enrollments'});continue;
    }
    const existing=existingRecords.get(key);
    if(existing&&(existing.version!==0||existing.attempt_no!==1||existing.status!=='Not taken'||existing.grade!==null||existing.transfer_school||existingAttempts.has(key)||!['Unassigned',latest.instructor].includes(existing.instructor))){
      if(existing.grade!==latest.grade||existing.status!==latest.status)reviews.push({...latest,reason:'existing_saved_record',existing});
      continue;
    }
    const failures=history.slice(0,-1).filter(r=>r.status==='Failed'&&(r.schoolYear!==latest.schoolYear||r.semester!==latest.semester));
    const uniqueFailures=[...new Map(failures.map(r=>[r.schoolYear+'|'+r.semester,r])).values()];
    for(const [index,failure] of uniqueFailures.entries())attempts.push({...failure,attemptNo:index+1});
    records.push({...latest,attemptNo:uniqueFailures.length+1,expectedVersion:existing?.version??0});
  }
  const newStudents=[...students.values()].filter(s=>!existingStudents.has(s.studentNo));
  return {students:[...students.values()],newStudents,records,attempts,instructors:[...instructors].map(([key,name])=>({key,name})),archive,reviews,
    summary:{source:totals,studentProfiles:students.size,newStudents:newStudents.length,records:records.length,failedAttempts:attempts.length,instructors:instructors.size,archiveRecords:archive.length,reviews:reviews.reduce((a,r)=>(a[r.reason]=(a[r.reason]||0)+1,a),{})}};
}
