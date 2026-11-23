import { read, utils } from 'xlsx';
import { gradeImportMaxFileBytes, gradeImportMaxRows, gradeImportTerm } from '../../shared/grade-import.js';

const columns = {
  schoolYear: 'school year', semester: 'semester', studentNo: 'student id', subjectCode: 'subject',
  title: 'subject title', units: 'units', finalGrade: 'final grade',
  removalGrade: 'removal grade', lastName: 'last name', program: 'program',
};
const required = ['schoolYear', 'semester', 'studentNo', 'subjectCode', 'title', 'units', 'finalGrade'];
const knownHeadings = new Set(Object.values(columns));
const normalizeHeader = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function gradeLayout(sheet) {
  const range = utils.decode_range(sheet['!ref'] || 'A1');
  for (let row = range.s.r; row < Math.min(range.e.r + 1, 10); row++) {
    const positions = {};
    const duplicates = new Set();
    for (let column = range.s.c; column <= Math.min(range.e.c, 63); column++) {
      const heading = normalizeHeader(sheet[utils.encode_cell({ r: row, c: column })]?.v);
      if (!knownHeadings.has(heading)) continue;
      if (Object.hasOwn(positions, heading)) duplicates.add(heading);
      positions[heading] = column;
    }
    if (required.every(key => Object.hasOwn(positions, columns[key]))) {
      if (Object.values(columns).some(heading => duplicates.has(heading))) throw new Error('The grade sheet has duplicate column headings.');
      return { sheet, firstRow: row + 1, lastRow: utils.decode_range(sheet['!fullref'] || sheet['!ref']).e.r, positions };
    }
  }
  return null;
}

export async function readGradeWorkbook(file) {
  const extension = /\.(xlsx?)$/i.exec(file.name)?.[1].toLowerCase();
  if (!extension) throw new Error('Choose an Excel .xls or .xlsx file.');
  if (!file.size || file.size > gradeImportMaxFileBytes) throw new Error('Choose a non-empty Excel file up to 5 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const signature = extension === 'xlsx' ? [0x50, 0x4b, 0x03, 0x04] : [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (!signature.every((byte, index) => bytes[index] === byte)) throw new Error('The file contents do not match its Excel extension.');
  let workbook;
  try { workbook = read(bytes, { type: 'array', sheetRows: gradeImportMaxRows + 10, cellHTML: false, cellText: false }); }
  catch { throw new Error('Excel could not read this workbook. Save an unprotected copy and try again.'); }
  const layouts = workbook.SheetNames.map(name => gradeLayout(workbook.Sheets[name])).filter(Boolean);
  if (layouts.length !== 1) throw new Error('Use one grade sheet with the required column headings.');
  const { sheet, firstRow, lastRow, positions } = layouts[0];
  if (lastRow - firstRow + 1 > gradeImportMaxRows) throw new Error('Upload up to 5,000 rows per file.');

  const rows = [];
  let term;
  for (let r = firstRow; r <= lastRow; r++) {
    const values = {};
    let invalidCell = false;
    for (const [key, heading] of Object.entries(columns)) {
      const c = positions[heading];
      const cell = c === undefined ? undefined : sheet[utils.encode_cell({ r, c })];
      if (cell?.f || cell?.F || cell?.t === 'e') invalidCell = true;
      values[key] = String(cell?.v ?? '').trim();
    }
    if (!invalidCell && Object.values(values).every(value => !value)) continue;
    const row = r + 1;
    const { schoolYear, semester, ...fields } = values;
    const rowTerm = gradeImportTerm(schoolYear, semester);
    if (!rowTerm) throw new Error(`Row ${row} needs a valid School Year and Semester.`);
    if (term && (term.schoolYear !== rowTerm.schoolYear || term.semester !== rowTerm.semester)) throw new Error(`Row ${row} belongs to a different term. Upload one semester per file.`);
    term = rowTerm;
    rows.push({ row, ...fields, invalidCell });
  }
  if (!rows.length) throw new Error('The workbook does not contain any grade rows.');
  return { ...term, rows };
}
