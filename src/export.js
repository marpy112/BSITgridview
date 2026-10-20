import { nextRetakeTerm, retakeLabel } from '../shared/retakes.js';
import { termLabels, yearLabels } from './data.js';

export async function createPdf(headers, rows, { title = 'Data report', metadata = [] } = {}) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const landscape = headers.length > 6;
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4', compress: true });
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const margin = 14;
  const available = width - margin * 2;
  const generated = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
  const details = [...metadata.filter(Boolean), `${rows.length} ${rows.length === 1 ? 'record' : 'records'} | Generated ${generated} (UTC+8)`];
  doc.setProperties({ title: `BSIT gradeview - ${title}`, subject: 'Student academic records', creator: 'BSIT gradeview', author: 'BSIT gradeview' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const detailLines = details.flatMap(line => doc.splitTextToSize(String(line), available));
  doc.setFontSize(12);
  const titleLines = doc.splitTextToSize(title, available);
  const tableTop = 30 + titleLines.length * 5 + detailLines.length * 4;
  const columnStyles = {};
  headers.forEach((header, index) => {
    if (['Units','Grade','Courses','Total units','Earned units','GWA','Year level','Completed courses','Pending records','Students assigned','Passed records','Total records','Completion'].includes(header)) columnStyles[index] = { halign: 'center' };
  });
  autoTable(doc, {
    head: [headers],
    body: rows.map(row => row.map(value => value == null ? '' : String(value))),
    startY: tableTop,
    margin: { top: tableTop, right: margin, bottom: 19, left: margin },
    theme: 'striped',
    styles: { font: 'helvetica', fontSize: headers.length > 9 ? 7 : 8, cellPadding: 2.3, overflow: 'linebreak', valign: 'middle', lineColor: [229, 234, 243], lineWidth: 0.1 },
    headStyles: { fillColor: [32, 55, 95], textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 248, 253] },
    columnStyles,
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    willDrawPage() {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.setTextColor(32, 55, 95);
      doc.text('BSIT gradeview', margin, 19);
      doc.setFontSize(12);
      doc.text(titleLines, margin, 27);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(110, 125, 150);
      doc.text(detailLines, margin, 29 + titleLines.length * 5, { lineHeightFactor: 1.4 });
    },
  });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setDrawColor(225, 232, 242);
    doc.line(margin, height - 15, width - margin, height - 15);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(130, 143, 165);
    doc.text('For reference only - Unofficial academic record', margin, height - 10);
    doc.text(`Page ${page} of ${pages}`, width - margin, height - 10, { align: 'right' });
  }
  return doc;
}

export async function downloadPdf(filename, headers, rows, options) {
  const doc = await createPdf(headers, rows, options);
  const url = URL.createObjectURL(doc.output('blob'));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.replace(/\.[^.]+$/, '') + '.pdf';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const courseHeaders = ['Year', 'Term', 'Course code', 'Descriptive title', 'Instructor', 'Units', 'Grade', 'Status', 'Prerequisite / OJT requirement', 'School year taken', 'Term taken', 'Transferred school', 'Retake / attempts'];
export function courseExportRows(courses) {
  return courses.map(course => [yearLabels[course.year], termLabels[course.semester], course.code, course.title, course.instructor, course.units, course.grade === null ? 'Pending' : course.grade.toFixed(2), course.status, course.prerequisite, course.academicYearTaken || 'Not recorded', termLabels[course.semesterTaken] || 'Not recorded', course.transferSchool || '', retakeSummary(course)]);
}

function retakeSummary(course) {
  const next = course.status === 'Failed' ? nextRetakeTerm(course.academicYearTaken, course.semesterTaken) : null;
  return [
    ...(next ? ['Retake: ' + retakeLabel(next)] : []),
    ...(course.attemptNumber > 1 ? ['Current attempt: ' + course.attemptNumber] : []),
    ...(course.pastAttempts || []).map(attempt => 'Attempt ' + attempt.attemptNumber + ': ' + attempt.grade.toFixed(2) + ' Failed / ' + retakeLabel({ schoolYear: attempt.academicYearTaken, semester: attempt.semesterTaken }) + (attempt.transferSchool ? ' / ' + attempt.transferSchool : '')),
  ].join('\n');
}
