import fs from 'node:fs';
const rows = JSON.parse(fs.readFileSync(new URL('../src/curriculum.json', import.meta.url), 'utf8'));
const sql = value => `'${String(value).replaceAll("'", "''")}'`;
const statements = rows.map((course, index) => `INSERT INTO courses(code,title,units,year_level,semester,prerequisite,source_requirement_column,sort_order) VALUES(${[course.code,course.title,course.units,course.year,course.semester,course.prerequisite,course.sourceRequirementColumn,index].map(sql).join(',')});`);
fs.writeFileSync(new URL('../migrations/0002_curriculum.sql', import.meta.url), '-- BSIT curriculum revised 2023, effective AY 2023-2024.\n' + statements.join('\n') + '\n');
console.log(`Generated curriculum migration: ${rows.length} courses.`);
