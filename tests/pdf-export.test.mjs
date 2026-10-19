import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import path from 'node:path';

const fonts = path.resolve('node_modules/pdfjs-dist/standard_fonts').replaceAll('\\', '/') + '/';

test('PDF exports preserve records, accented names, table headers, metadata, and pagination', async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
  try {
    const { createPdf, courseHeaders, courseExportRows, downloadPdf } = await server.ssrLoadModule('/src/export.js');
    const { courses } = await server.ssrLoadModule('/src/data.js');
    const term = courses.filter(course => course.year === 2 && course.semester === '2');
    const rows = courseExportRows(term.map((course, index) => index === 0 ? { ...course, instructor: 'Instructor Peña', grade: 1.5, status: 'Passed' } : course));
    assert.equal(rows.length, 10);
    const report = await createPdf(courseHeaders, rows, { title: 'Student progress record', metadata: ['Student: Test BEÑAS | Student ID: TEST-001', 'Second year | 2nd semester | Status: All'] });
    const bytes = new Uint8Array(report.output('arraybuffer'));
    assert(new TextDecoder().decode(bytes.slice(0, 8)).startsWith('%PDF-'));
    const loading = getDocument({ data: bytes, standardFontDataUrl: fonts });
    const pdf = await loading.promise;
    const firstPage = await pdf.getPage(1);
    assert(firstPage.view[2] > firstPage.view[3], 'wide tables use landscape');
    const text = (await firstPage.getTextContent()).items.map(item => item.str).join(' ');
    for (const expected of ['BSIT gradeview','Student progress record','BEÑAS','Peña','1.50','Pending','Information Management','TEST-001']) assert(text.includes(expected), expected);
    assert(!text.includes('Capstone Project and Research 2'), 'only the selected term is exported');
    await loading.destroy();

    const headers = ['Student number','Student name','Program','Year level','GWA','Completed courses','Pending records','Standing'];
    const directoryRows = Array.from({ length: 161 }, (_, index) => [`TEST-${String(index + 1).padStart(3,'0')}`, `Student ${index + 1} BEÑAS`, 'BS Information Technology', 2, '1.50', 10, 2, '2 pending']);
    const directory = await createPdf(headers, directoryRows, { title: 'Student directory', metadata: ['Filter: All students'] });
    const multiLoading = getDocument({ data: new Uint8Array(directory.output('arraybuffer')), standardFontDataUrl: fonts });
    const multi = await multiLoading.promise;
    assert(multi.numPages > 1);
    let allText = '';
    for (let page = 1; page <= multi.numPages; page++) {
      const content = (await (await multi.getPage(page)).getTextContent()).items.map(item => item.str).join(' ');
      assert(content.includes('BSIT gradeview'));
      assert(content.includes(`Page ${page} of ${multi.numPages}`));
      assert(content.includes('Student number'), 'column headers repeat on every page');
      allText += content;
    }
    assert(allText.includes('TEST-161'), 'last record is present');
    await multiLoading.destroy();

    const compact = await createPdf(['Student and course','Update'], [['Test student | IT 12','Passed | Grade 1.50']], { title: 'Recent updates' });
    assert(compact.internal.pageSize.getHeight() > compact.internal.pageSize.getWidth(), 'compact tables use portrait');

    const nativeDocument = globalThis.document;
    const nativeCreate = URL.createObjectURL;
    const nativeRevoke = URL.revokeObjectURL;
    let blob, clicked = false, removed = false;
    const link = { click() { clicked = true; }, remove() { removed = true; } };
    try {
      globalThis.document = { body: { appendChild() {} }, createElement() { return link; } };
      URL.createObjectURL = value => { blob = value; return 'blob:pdf-export-test'; };
      URL.revokeObjectURL = () => {};
      await downloadPdf('student-record.pdf', courseHeaders, rows);
      assert.equal(link.download, 'student-record.pdf');
      assert.equal(blob.type, 'application/pdf');
      assert(clicked && removed);
      await new Promise(resolve => setTimeout(resolve, 1100));
    } finally {
      globalThis.document = nativeDocument;
      URL.createObjectURL = nativeCreate;
      URL.revokeObjectURL = nativeRevoke;
    }
  } finally { await server.close(); }
});
