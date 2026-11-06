import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api.js';
import { downloadPdf } from '../export.js';
import { deansListCriteria } from '../../shared/deans-list.js';
import AdminIcon from './AdminIcon.jsx';
import './deans-list.css';

const semesterLabels = { '1': '1st semester', '2': '2nd semester', summer: 'Summer' };
const yearLabel = year => year ? `Year ${year}` : 'Not recorded';
const formatGwa = value => value === null ? '—' : value.toFixed(2);
const verifiedLabel = value => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const rowsForYear = (rows, year) => year === 'all' ? rows : rows.filter(row => row.yearLevel === year);

function QualifiedTable({ rows, print = false }) {
  return <table className="deans-table"><caption className={print ? '' : 'deans-visually-hidden'}>Qualified students — all enrolled semester grades verified</caption><thead><tr><th scope="col">Student number</th><th scope="col">Student name</th><th scope="col">Year level</th><th scope="col">Final grades</th><th scope="col">Units</th><th scope="col">GWA</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{row.id}</td><th scope="row">{row.name}</th><td>{yearLabel(row.yearLevel)}</td><td>{row.posted}/{row.expected}</td><td>{row.units}</td><td><strong>{formatGwa(row.gwa)}</strong></td></tr>)}</tbody></table>;
}

export default function DeansList({ academicTerm, students, onReviewStudent }) {
  const [schoolYearStart, setSchoolYearStart] = useState(String(academicTerm.schoolYearStart));
  const [semester, setSemester] = useState(academicTerm.semester);
  const [year, setYear] = useState('all');
  const [tab, setTab] = useState('qualified');
  const [reload, setReload] = useState(0);
  const [state, setState] = useState({ data: null, loading: true, error: '', key: '' });
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [printRequested, setPrintRequested] = useState(false);
  const mounted = useRef(true);
  const validYear = /^\d{4}$/.test(schoolYearStart) && Number(schoolYearStart) >= 2000 && Number(schoolYearStart) <= 2199;
  const schoolYear = `${schoolYearStart}-${Number(schoolYearStart) + 1}`;
  const key = `${schoolYear}|${semester}`;
  const path = `/api/deans-list?schoolYear=${encodeURIComponent(schoolYear)}&semester=${encodeURIComponent(semester)}`;
  const report = state.key === key ? state.data : null;
  const loading = validYear && (state.loading || state.key !== key);
  const qualified = rowsForYear(report?.qualified || [], year);
  const pending = rowsForYear(report?.pending || [], year);
  const ineligible = rowsForYear(report?.ineligible || [], year);
  const termLabel = `${schoolYear.replace('-', '–')} · ${semesterLabels[semester]}`;
  const selectedRows = ({ qualified, pending, ineligible })[tab];
  const locked = Boolean(busy);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setNotice(''); setTab('qualified');
    if (!validYear) { setState({ data: null, loading: false, error: '', key }); return; }
    const controller = new AbortController();
    let active = true;
    setState({ data: null, loading: true, error: '', key });
    apiRequest(path, { signal: controller.signal }).then(data => {
      if (active) setState({ data, loading: false, error: '', key });
    }).catch(error => { if (active) setState({ data: null, loading: false, error: error.message, key }); });
    return () => { active = false; controller.abort(); };
  }, [path, key, validYear, reload, students]);

  useEffect(() => {
    if (!printRequested) return;
    if (!report || loading || !qualified.length) {
      setPrintRequested(false); setBusy('');
      setNotice('The report changed while preparing to print. Refresh and print the verified list again.');
      return;
    }
    const frame = requestAnimationFrame(() => {
      try { if (mounted.current) window.print(); }
      catch { if (mounted.current) setNotice('Printing could not start. Try again or download the PDF.'); }
      finally { if (mounted.current) { setPrintRequested(false); setBusy(''); } }
    });
    return () => cancelAnimationFrame(frame);
  }, [printRequested, report, loading, qualified.length]);

  async function prepareReport(action) {
    setBusy(action); setNotice('');
    try {
      // Re-read the database before any output so a recent grade edit cannot
      // leave a stale student on the printed or downloaded list.
      const fresh = await apiRequest(path);
      if (!mounted.current) return;
      setState({ data: fresh, loading: false, error: '', key });
      const rows = rowsForYear(fresh.qualified, year);
      if (!rows.length) { setNotice('No qualified students remain after refreshing. No report was produced.'); setBusy(''); return; }
      if (action === 'print') { setPrintRequested(true); return; }
      await downloadPdf(`deans-list-${schoolYear}-${semester}-${year}.pdf`, ['Student number','Student name','Year level','Final grades','Units','GWA'], rows.map(row => [row.id,row.name,yearLabel(row.yearLevel),`${row.posted}/${row.expected}`,row.units,formatGwa(row.gwa)]), {
        title: 'Dean’s List', metadata: [termLabel, year === 'all' ? 'All year levels' : yearLabel(year), deansListCriteria, 'GWA is unit-weighted across all enrolled subjects, including PE and NSTP.', `Verified: ${verifiedLabel(fresh.verifiedAt)} (UTC+8)`],
      });
      if (mounted.current) { setNotice('Dean’s List PDF downloaded.'); setBusy(''); }
    } catch (error) {
      if (mounted.current) { setNotice(`Report could not be prepared: ${error.message}`); setBusy(''); }
    }
  }

  return <div className="deans-list-page">
    <section className="deans-rules" aria-labelledby="deans-rules-title"><span className="deans-rules-icon"><AdminIcon name="deans-list" /></span><div><h2 id="deans-rules-title">Dean’s List qualifications</h2><ul><li>Every final grade is <strong>1.00–2.00</strong></li><li>No INC</li><li>Not a transferee</li><li>All enrolled semester grades are posted</li></ul><p>Eligibility uses the selected semester’s enrollment roster and saved grades. Missing rosters, subjects, and grades stay under “Awaiting complete records.” GWA includes all enrolled subject units, including PE and NSTP.</p></div></section>
    <section className="admin-panel deans-controls" aria-label="Dean’s List semester">
      <div className="deans-filters"><label><span>School year starts</span><input type="number" min="2000" max="2199" step="1" value={schoolYearStart} onChange={event => setSchoolYearStart(event.target.value)} disabled={locked} aria-describedby="deans-school-year-hint" /><small id="deans-school-year-hint">{validYear ? schoolYear.replace('-', '–') : 'Enter a year from 2000 to 2199.'}</small></label><label><span>Semester</span><select value={semester} onChange={event => setSemester(event.target.value)} disabled={locked}><option value="1">1st semester</option><option value="2">2nd semester</option><option value="summer">Summer</option></select></label><label><span>Year level</span><select value={year} onChange={event => { setYear(event.target.value); setNotice(''); }} disabled={locked}><option value="all">All year levels</option>{[1,2,3,4].map(value => <option key={value} value={value}>Year {value}</option>)}</select></label></div>
      <div className="deans-output-actions"><button className="secondary-button" disabled={locked || loading || !validYear} onClick={() => setReload(value => value + 1)}>Refresh list</button><button className="secondary-button" disabled={locked || loading || !qualified.length} onClick={() => prepareReport('pdf')}>{busy === 'pdf' ? 'Verifying grades…' : 'Download PDF'}</button><button className="primary-button" disabled={locked || loading || !qualified.length} onClick={() => prepareReport('print')}>{busy === 'print' ? 'Verifying grades…' : 'Print Dean’s List'}</button></div>
    </section>
    {notice && <p className="deans-notice" role="status">{notice}</p>}
    {!validYear ? <div className="admin-panel dashboard-empty" role="status"><h3>Choose a school year</h3><p>Enter a valid year to check semester eligibility.</p></div> : loading ? <div className="admin-panel dashboard-empty" role="status">Checking semester rosters and final grades…</div> : state.error ? <div className="admin-panel dashboard-empty" role="alert"><h3>The list could not be verified</h3><p>{state.error}</p><button className="secondary-button" onClick={() => setReload(value => value + 1)}>Try again</button></div> : report && <>
      <div className="deans-statistics" aria-label="Eligibility summary"><div><span>Qualified</span><strong>{qualified.length}</strong><small>All requirements met</small></div><div><span>Awaiting complete records</span><strong>{pending.length}</strong><small>Roster or grades need review</small></div><div><span>Not qualified</span><strong>{ineligible.length}</strong><small>Grade or transferee requirement</small></div></div>
      <section className="admin-panel deans-results"><div className="admin-section-heading"><div><h2>{termLabel}</h2><p>{year === 'all' ? 'All year levels' : yearLabel(year)} · Verified {verifiedLabel(report.verifiedAt)} (UTC+8)</p></div><span className="deans-verified"><AdminIcon name="check" /> Semester checked</span></div>
        <div className="deans-result-tabs" role="group" aria-label="Eligibility groups">{[['qualified','Qualified',qualified],['pending','Awaiting complete records',pending],['ineligible','Not qualified',ineligible]].map(([value,label,rows]) => <button className={tab === value ? 'selected' : ''} aria-pressed={tab === value} key={value} onClick={() => setTab(value)}>{label}<span>{rows.length}</span></button>)}</div>
        {selectedRows.length ? tab === 'qualified' ? <><p className="deans-result-note">Only these students appear in the printed list and PDF. Every enrolled subject has a valid final grade of 2.00 or better. Sorted by semester GWA.</p><div className="deans-table-scroll" tabIndex={0} role="region" aria-label="Qualified Dean’s List students"><QualifiedTable rows={qualified} /></div></> : <div className="deans-review-list">{selectedRows.map(row => <article key={row.id}><div className="deans-review-heading"><div><h3>{row.name}</h3><p>{row.id} · {yearLabel(row.yearLevel)} · {row.posted}/{row.expected || '?'} final grades posted</p></div><button className="secondary-button" disabled={locked} onClick={() => { const student = students.find(student => student.id === row.id); if (student) onReviewStudent(student); }}>Review student</button></div><ul>{row.reasons.map(reason => <li key={reason.code}>{reason.text}</li>)}</ul></article>)}</div> : <div className="dashboard-empty" role="status"><AdminIcon name="deans-list" /><h3>{tab === 'qualified' ? 'No qualified students for this selection' : tab === 'pending' ? 'No records awaiting completion' : 'No excluded students for this selection'}</h3><p>{tab === 'qualified' ? 'Only students with a verified semester roster, all final grades at 2.00 or better, no INC, and no transferee status are included.' : 'Change the semester or year-level filter to review another group.'}</p></div>}
        <p className="deans-result-note">{report.evaluated} students have enrollment or grade records in this semester. {report.notInTerm} have neither and were not evaluated. Only qualified students are printable. Data is verified again before printing or downloading.</p>
      </section>
      <section className="deans-print-report" aria-label="Printable Dean’s List"><div className="deans-print-brand">BSIT gradeview</div><h1>Dean’s List</h1><h2>{termLabel}</h2><p>{year === 'all' ? 'All year levels' : yearLabel(year)} · {qualified.length} qualified {qualified.length === 1 ? 'student' : 'students'}</p><p className="deans-print-criteria">{deansListCriteria}</p><p>Verified {verifiedLabel(report.verifiedAt)} (UTC+8)</p><QualifiedTable rows={qualified} print /><p className="deans-print-footer">GWA is unit-weighted across all enrolled semester subjects, including PE and NSTP. For administrative review.</p></section>
    </>}
  </div>;
}
