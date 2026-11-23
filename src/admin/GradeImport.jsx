import { useState } from 'react';
import { apiRequest } from '../api.js';
import { retakeLabel } from '../../shared/retakes.js';
import AdminIcon from './AdminIcon.jsx';
import './grade-import.css';

const rowsPerPage = 20;
const displayGrade = (grade, status) => grade === null ? status || 'Not taken' : `${grade.toFixed(2)} · ${status}`;
const count = value => value.toLocaleString();

function ImportRows({ title, rows, showIssues }) {
  const [page, setPage] = useState(0);
  if (!rows.length) return null;
  const first = page * rowsPerPage;
  const last = Math.min(first + rowsPerPage, rows.length);
  return <section className="grade-import-rows">
    <h3>{title}</h3>
    <div className="grade-import-table" tabIndex={0} role="region" aria-label={title}>
      <table aria-label={title}>
        <thead><tr><th scope="col">Excel row</th><th scope="col">Student ID</th><th scope="col">Subject</th>
          {showIssues ? <th scope="col">Review reason</th> : <><th scope="col">Previous grade</th><th scope="col">Uploaded grade</th></>}
        </tr></thead>
        <tbody>{rows.slice(first, last).map(row => <tr key={row.row}>
          <td>{row.row}</td><td>{row.studentNo || '—'}</td><td>{row.course || '—'}</td>
          {showIssues ? <td>{row.message}</td> : <><td>{displayGrade(row.savedGrade, row.savedStatus)}</td><td>{displayGrade(row.grade, row.status)}</td></>}
        </tr>)}</tbody>
      </table>
    </div>
    {rows.length > rowsPerPage && <nav className="grade-import-pagination" aria-label={`${title} pages`}>
      <span role="status">Showing {first + 1}–{last} of {count(rows.length)}</span>
      <button type="button" className="secondary-button" disabled={!page} onClick={() => setPage(page - 1)}>Previous</button>
      <button type="button" className="secondary-button" disabled={last === rows.length} onClick={() => setPage(page + 1)}>Next</button>
    </nav>}
  </section>;
}

export default function GradeImport({ onRefresh, onBusyChange }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [applied, setApplied] = useState(false);
  const [refreshError, setRefreshError] = useState(false);

  function setOperation(operation) {
    setBusy(operation);
    onBusyChange(Boolean(operation));
  }

  function chooseFile(event) {
    setFile(event.target.files[0] || null);
    setPreview(null);
    setApplied(false);
    setError('');
    setRefreshError(false);
  }

  async function previewFile(event) {
    event.preventDefault();
    if (!file || busy) return;
    setOperation('preview');
    setPreview(null);
    setApplied(false);
    setError('');
    setRefreshError(false);
    try {
      const { readGradeWorkbook } = await import('./grade-workbook.js');
      const upload = await readGradeWorkbook(file);
      const plan = await apiRequest('/api/grade-import/preview', { method: 'POST', body: JSON.stringify(upload) });
      setPreview({ upload, plan });
    } catch (error) { setError(error.message); }
    finally { setOperation(''); }
  }

  async function refreshRecords() {
    setRefreshError(false);
    try { await onRefresh(); }
    catch { setRefreshError(true); }
  }

  async function applyGrades() {
    if (!preview || !preview.plan.summary.changed || busy || applied) return;
    setOperation('import');
    setError('');
    try {
      const { upload, plan } = preview;
      await apiRequest('/api/grade-import/apply', { method: 'POST', body: JSON.stringify({ ...upload, fingerprint: plan.fingerprint }) });
      setApplied(true);
      await refreshRecords();
    } catch (error) {
      setError(error.message);
      if (error.status === 409) setPreview(null);
    } finally { setOperation(''); }
  }

  const plan = preview?.plan;
  const summary = plan?.summary;
  const term = plan && retakeLabel({ schoolYear: plan.schoolYear.replace('-', '–'), semester: plan.semester });
  return <div className="grade-import-page">
    <section className="admin-panel">
      <div className="admin-section-heading"><div>
        <h2>Choose an Excel workbook</h2>
        <p>Upload an .xls or .xlsx file with grades for one school year and semester.</p>
      </div></div>
      <form className="grade-import-file" onSubmit={previewFile}>
        <div><label htmlFor="grade-workbook">Grade workbook</label>
          <input id="grade-workbook" type="file" accept=".xls,.xlsx" required disabled={Boolean(busy)} onChange={chooseFile} aria-describedby="grade-workbook-limits" />
          <small id="grade-workbook-limits">Up to 5 MB and 5,000 grade rows</small>
        </div>
        <button type="submit" className="primary-button" disabled={!file || Boolean(busy)}>
          <AdminIcon name="grades" />{busy === 'preview' ? 'Checking workbook…' : 'Preview grades'}
        </button>
      </form>
      <details className="grade-import-format"><summary>Workbook columns</summary>
        <p>Include School Year, Semester, Student ID, Subject, Subject Title, Units, and Final Grade. Grade View also reads Removal Grade, Last Name, and Program when supplied.</p>
        <p>Use a school year such as 2026-2027 and a semester such as 1st, 2nd, or Summer. Enter one row per student and subject. A removal grade takes precedence over the final grade. Blank and pending grades are skipped.</p>
      </details>
    </section>
    {error && <p className="form-error grade-import-message" role="alert">{error}</p>}
    {plan && <section className="admin-panel grade-import-review" aria-label="Grade import preview">
      <div className="admin-section-heading"><div><h2>{applied ? 'Import complete' : 'Review grade import'}</h2>
        <p><strong>{term}</strong> · {count(summary.rows)} workbook rows</p></div></div>
      <dl className="grade-import-summary">
        <div><dt>{applied ? 'Grades saved' : 'Grades to save'}</dt><dd>{count(summary.changed)}</dd></div>
        <div><dt>Already match</dt><dd>{count(summary.unchanged)}</dd></div>
        <div><dt>Blank or pending</dt><dd>{count(summary.pending)}</dd></div>
        <div><dt>Need review</dt><dd>{count(summary.issues)}</dd></div>
      </dl>
      <p className="grade-import-message" role="status">{applied
        ? `Saved ${count(summary.changed)} ${summary.changed === 1 ? 'grade' : 'grades'} for ${count(summary.students)} ${summary.students === 1 ? 'student' : 'students'}.`
        : summary.changed ? `${count(summary.students)} ${summary.students === 1 ? 'student' : 'students'} will receive grade updates.${summary.replacements ? ` This includes ${count(summary.replacements)} previously recorded ${summary.replacements === 1 ? 'grade' : 'grades'}.` : ''}`
          : 'No grades are ready to save.'}</p>
      {refreshError && <p className="grade-import-message" role="alert">The grades were saved. Refresh the portal to see the updated records. <button type="button" className="text-button" disabled={Boolean(busy)} onClick={async () => { setOperation('refresh'); await refreshRecords(); setOperation(''); }}>Refresh records</button></p>}
      {summary.issues > 0 && <p className="grade-import-message">Rows listed under Needs review are skipped. Correct those rows and preview a new upload to import them.</p>}
      <ImportRows title="Needs review" rows={plan.issues} showIssues />
      <ImportRows title="Grade changes" rows={plan.changes} />
      {!applied && summary.changed > 0 && <div className="grade-import-actions">
        <button type="button" className="primary-button" onClick={applyGrades} disabled={Boolean(busy)}>{busy === 'import' ? 'Saving grades…' : `Import ${count(summary.changed)} ${summary.changed === 1 ? 'grade' : 'grades'}`}</button>
      </div>}
    </section>}
  </div>;
}
