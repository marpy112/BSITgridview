import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { hash } from 'bcryptjs';

const args = new Set(process.argv.slice(2));
if (args.has('--remote') === args.has('--local')) throw new Error('Choose exactly one target: --local or --remote.');
if ([...args].some(arg => !['--local','--remote'].includes(arg))) throw new Error('Only --local or --remote is supported.');
const target = args.has('--remote') ? '--remote' : '--local';
if (target === '--remote') {
  const config = JSON.parse(fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  if (config.d1_databases[0].database_id === '00000000-0000-0000-0000-000000000000') throw new Error('Bind your hosted database first: npm run db:bind -- YOUR_DATABASE_ID.');
}
const sql = value => value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const accounts = [];

async function passwordPrompt() {
  if (!process.stdin.isTTY) throw new Error('Run account creation in an interactive terminal. Passwords are not accepted in command arguments.');
  process.stdout.write('Password (12+ characters, hidden): ');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let password = '';
    function finish(error) { process.stdin.off('data', receive); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); error ? reject(error) : resolve(password); }
    function receive(chunk) {
      for (const char of chunk.toString()) {
        if (char === '\u0003') { finish(new Error('Cancelled.')); return; }
        if (char === '\r' || char === '\n') { finish(); return; }
        if (char === '\u007f' || char === '\b') password = password.slice(0, -1);
        else if (char >= ' ') password += char;
      }
    }
    process.stdin.on('data', receive);
  });
}

{
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  let account;
  try {
    const role = (await prompt.question('Role (admin or student): ')).trim();
    if (!['admin', 'student'].includes(role)) throw new Error('Role must be admin or student.');
    const identifier = (await prompt.question(role === 'admin' ? 'Admin email: ' : 'Student number / iLearn number: ')).trim().toLowerCase();
    if (!identifier || identifier.length > 150 || (role === 'admin' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier))) throw new Error('Enter a valid identifier.');
    account = { role, identifier };
    if (role === 'student') {
      account.firstName = (await prompt.question('First name: ')).trim().normalize('NFC');
      account.middleName = (await prompt.question('Middle name (optional): ')).trim().normalize('NFC');
      account.lastName = (await prompt.question('Last name (initial password; preserve spaces and accents): ')).trim().normalize('NFC');
      account.name = [account.firstName,account.middleName,account.lastName].filter(Boolean).join(' ');
      account.year = Number(await prompt.question('Year level (1-4): '));
      account.email = (await prompt.question('Student email (optional): ')).trim();
      if (!account.firstName || !account.lastName || ![1,2,3,4].includes(account.year)) throw new Error('First/last names and a valid year level are required.');
    }
  } finally { prompt.close(); }
  account.password = account.role === 'student' ? account.lastName : await passwordPrompt();
  if ((account.role === 'admin' && account.password.length < 12) || new TextEncoder().encode(account.password).length > 72) throw new Error('Admin passwords require 12+ characters; passwords must not exceed 72 UTF-8 bytes.');
  account.mustChangePassword = account.role === 'student' ? 1 : 0;
  accounts.push(account);
}

const statements = [];
for (const account of accounts) {
  const passwordHash = await hash(account.password, 12);
  if (account.role === 'student') {
    statements.push(`INSERT INTO students(student_no,name,year_level,email,first_name,middle_name,last_name) VALUES(${[account.identifier,account.name,account.year,account.email,account.firstName || '',account.middleName || '',account.lastName || ''].map(sql).join(',')}) ON CONFLICT(student_no) DO NOTHING;`);
    statements.push(`INSERT INTO progress_records(student_no,course_code) SELECT ${sql(account.identifier)},code FROM courses WHERE 1 ON CONFLICT(student_no,course_code) DO NOTHING;`);
  }
  statements.push(`INSERT INTO accounts(id,identifier,role,password_hash,student_no,must_change_password) VALUES(${[crypto.randomUUID(),account.identifier,account.role,passwordHash,account.role === 'student' ? account.identifier : null,account.mustChangePassword || 0].map(sql).join(',')}) ON CONFLICT(role,identifier) DO NOTHING;`);
}
const root = fileURLToPath(new URL('../', import.meta.url));
const file = path.join(root, `.db-account-${crypto.randomUUID()}.sql`);
try {
  fs.writeFileSync(file, statements.join('\n'), { mode: 0o600 });
  const command = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const result = spawnSync(process.execPath, [command,'d1','execute','bsit-gradeview-db',target,'--file',file], { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw result.error || new Error('Account creation failed. Check that migrations have been applied.');
  console.log(`Provisioned ${accounts.length} account(s) in the ${target.slice(2)} database. Existing accounts and passwords are unchanged.`);
} finally { fs.rmSync(file, { force: true }); }
