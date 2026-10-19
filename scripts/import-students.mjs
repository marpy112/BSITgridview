import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { hash } from 'bcryptjs';

export function parseMasterList(text) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const headers = lines.shift().split('\t');
  for (const header of ['student_id','last_name','first_name','middle_name','course','year']) {
    if (!headers.includes(header)) throw new Error(`Missing TSV column: ${header}`);
  }
  const seen = new Set();
  return lines.filter(line => line.trim()).map((line, index) => {
    const values = line.split('\t');
    if (values.length !== headers.length) throw new Error(`Row ${index + 2}: column count does not match the header.`);
    const item = Object.fromEntries(headers.map((key, i) => [key, values[i].trim().normalize('NFC')]));
    if (!/^\d{7,8}$/.test(item.student_id) || seen.has(item.student_id)) throw new Error(`Row ${index + 2}: invalid or duplicate student ID.`);
    if (!item.first_name || !item.last_name || item.course !== 'BSIT' || !['1','2','3','4'].includes(item.year)) throw new Error(`Row ${index + 2}: invalid student details.`);
    seen.add(item.student_id);
    return item;
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--local') === args.includes('--remote')) throw new Error('Choose exactly one target: --local or --remote.');
  const target = args.includes('--remote') ? '--remote' : '--local';
  const fileIndex = args.indexOf('--file');
  if (fileIndex === -1 || !args[fileIndex + 1]) throw new Error('Provide --file path/to/students.tsv.');
  const students = parseMasterList(fs.readFileSync(args[fileIndex + 1], 'utf8'));
  if (!students.length) throw new Error('No students to import.');
  console.log(`Validated ${students.length} unique BSIT students. Year levels: ${[...new Set(students.map(s => s.year))].join(', ')}.`);
  if (args.includes('--dry-run')) return;
  const root = fileURLToPath(new URL('../', import.meta.url));
  const config = JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));
  if (target === '--remote' && config.d1_databases[0].database_id === '00000000-0000-0000-0000-000000000000') throw new Error('Bind your Cloudflare database first.');
  const quote = value => `'${String(value).replaceAll("'", "''")}'`;
  const statements = [];
  for (const [index, student] of students.entries()) {
    const name = [student.first_name, student.middle_name, student.last_name].filter(Boolean).join(' ');
    const passwordHash = await hash(student.last_name, 12);
    statements.push(`INSERT INTO students(student_no,name,year_level,first_name,middle_name,last_name) VALUES(${[student.student_id,name,student.year,student.first_name,student.middle_name,student.last_name].map(quote).join(',')}) ON CONFLICT(student_no) DO UPDATE SET name=excluded.name,year_level=excluded.year_level,first_name=excluded.first_name,middle_name=excluded.middle_name,last_name=excluded.last_name;`);
    statements.push(`INSERT INTO progress_records(student_no,course_code) SELECT ${quote(student.student_id)},code FROM courses WHERE 1 ON CONFLICT(student_no,course_code) DO NOTHING;`);
    statements.push(`INSERT INTO accounts(id,identifier,role,password_hash,student_no,must_change_password) VALUES(${[crypto.randomUUID(),student.student_id,'student',passwordHash,student.student_id].map(quote).join(',')},1) ON CONFLICT(role,identifier) DO NOTHING;`);
    if ((index + 1) % 25 === 0) console.log(`Prepared ${index + 1}/${students.length} password hashes.`);
  }
  const temporary = path.join(root, `.db-account-${crypto.randomUUID()}.sql`);
  try {
    fs.writeFileSync(temporary, statements.join('\n'), { mode: 0o600 });
    const result = spawnSync(process.execPath, [path.join(root,'node_modules/wrangler/bin/wrangler.js'),'d1','execute','bsit-gradeview-db',target,'--file',temporary,'--json'], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    if (result.error || result.status !== 0) throw result.error || new Error(result.stderr || result.stdout || 'D1 import failed.');
    console.log(`Imported ${students.length} master-list students into ${target.slice(2)} D1. Existing grades, passwords, and first-login flags are preserved. New accounts require a password change.`);
  } finally { fs.rmSync(temporary, { force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
