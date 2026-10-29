import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api.js';
import { maxBulkCertificateRecipients } from '../../shared/certificates.js';
import { downloadCertificate, downloadCertificateBatch } from './pdf.js';

export default function BulkCertificateIssuer({ students, templates, template, templateId, loadingTemplate, onSelectTemplate, onBusyChange, renderPreview }) {
  const [query, setQuery] = useState('');
  const [year, setYear] = useState('all');
  const [selection, setSelection] = useState(new Set());
  const [otherNames, setOtherNames] = useState('');
  const [result, setResult] = useState(null);
  const [previewId, setPreviewId] = useState('');
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const allRef = useRef(null);
  const pending = useRef(null);
  const inFlight = useRef(false);
  const names = otherNames.split(/\r?\n/).map(name => name.normalize('NFC').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const count = selection.size + names.length;
  const filtered = students.filter(student => (year === 'all' || String(student.year) === year) && `${student.name} ${student.id}`.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedVisible = filtered.filter(student => selection.has(student.id)).length;
  const allVisible = filtered.length > 0 && selectedVisible === filtered.length;
  useEffect(() => { if (allRef.current) allRef.current.indeterminate = selectedVisible > 0 && !allVisible; }, [selectedVisible, allVisible]);
  const duplicateNames = new Set(names.map(name => name.toLowerCase())).size !== names.length;
  const invalidName = names.some(name => name.length > 180 || /[\u0000-\u001f\u007f]/.test(name));
  const previewCertificate = result?.certificates.find(item => item.id === previewId) || result?.certificates[0];
  const previewName = previewCertificate?.recipientName || students.find(student => selection.has(student.id))?.name || names[0] || 'Recipient Name';

  function setWorking(value) { setBusy(value); onBusyChange(value ? `bulk:${value}` : ''); }
  function toggle(id) {
    setError('');
    setSelection(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size + names.length < maxBulkCertificateRecipients) next.add(id);
      return next;
    });
  }
  function toggleVisible() {
    setError('');
    const next = new Set(selection);
    for (const student of filtered) allVisible ? next.delete(student.id) : next.add(student.id);
    if (next.size + names.length > maxBulkCertificateRecipients) { setError(`Select up to ${maxBulkCertificateRecipients} recipients per batch. Filter by year or name to choose a smaller group.`); return; }
    setSelection(next);
  }
  async function issue(event) {
    event.preventDefault();
    if (inFlight.current) return;
    if (!template || !count || count > maxBulkCertificateRecipients || duplicateNames || invalidName) { setError('Check the recipient selection and names before issuing.'); return; }
    inFlight.current = true; setWorking('issue'); setError('');
    const recipients = [...[...selection].sort().map(studentId => ({ studentId })), ...names.map(recipientName => ({ recipientName }))];
    const key = JSON.stringify([templateId, recipients]);
    if (pending.current?.key !== key) pending.current = { key, requestId: crypto.randomUUID() };
    try {
      const data = await apiRequest('/api/certificates/bulk', { method: 'POST', body: JSON.stringify({ templateId, recipients, requestId: pending.current.requestId }) });
      setResult({ ...data, template }); setPreviewId(data.certificates[0].id);
    } catch (error) { setError(`${error.message} Retry with the same selection to recover this batch without issuing it twice.`); }
    finally { inFlight.current = false; setWorking(''); }
  }
  async function download(certificate) {
    setWorking(certificate ? 'download-one' : 'download-all'); setProgress(0); setError('');
    try {
      if (certificate) await downloadCertificate(result.template, certificate);
      else await downloadCertificateBatch(result.template, result.certificates, { onProgress: completed => setProgress(completed) });
    } catch (error) { setError(`The certificates are saved. The PDF could not be prepared: ${error.message}`); }
    finally { setWorking(''); }
  }
  function startAnother() { setResult(null); setSelection(new Set()); setOtherNames(''); setPreviewId(''); setError(''); pending.current = null; }

  return <div className="certificate-bulk-workspace">
    {error && <p className="certificate-feedback is-error" role="alert">{error}</p>}
    <div className="certificate-workspace">
      <form className="admin-panel certificate-form" onSubmit={issue}>
        <div className="eyebrow">BULK CERTIFICATE ISSUANCE</div><h2>Award a whole group</h2><p>Choose recipients for one design. Every certificate receives a different ID and QR verification link.</p>
        <fieldset disabled={Boolean(busy) || Boolean(result)}>
          <label htmlFor="bulk-certificate-design">Certificate design</label><select id="bulk-certificate-design" value={templateId} required onChange={event => onSelectTemplate(event.target.value)}><option value="" disabled>Choose a design</option>{templates.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
          <div className="certificate-recipient-heading"><strong>Select recipients</strong><span>{count} / {maxBulkCertificateRecipients}</span></div>
          <label className="certificate-sr-only" htmlFor="bulk-student-search">Search students by name or ID</label><input id="bulk-student-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search student name or ID" />
          <label className="certificate-sr-only" htmlFor="bulk-student-year">Filter students by year</label><select id="bulk-student-year" value={year} onChange={event => setYear(event.target.value)}><option value="all">All year levels</option>{[1, 2, 3, 4].map(value => <option key={value} value={value}>Year {value}</option>)}</select>
          <div className="certificate-select-actions"><label><input ref={allRef} type="checkbox" checked={allVisible} disabled={!filtered.length} onChange={toggleVisible} />Select all shown ({filtered.length})</label><button type="button" disabled={!selection.size} onClick={() => setSelection(new Set())}>Clear selection</button></div>
          <div className="certificate-recipient-list" role="group" aria-label="Students to receive a certificate">
            {filtered.length ? filtered.map(student => <label key={student.id}><input type="checkbox" checked={selection.has(student.id)} disabled={!selection.has(student.id) && count >= maxBulkCertificateRecipients} onChange={() => toggle(student.id)} /><span><strong>{student.name}</strong><small>{student.id} · Year {student.year}</small></span></label>) : <p className="empty">No students match this search.</p>}
          </div>
          <label htmlFor="bulk-other-recipients">Other recipients <span className="certificate-optional">(optional)</span></label><textarea id="bulk-other-recipients" rows={4} maxLength={maxBulkCertificateRecipients * 182} value={otherNames} onChange={event => { setOtherNames(event.target.value); setError(''); }} placeholder="Enter one full name per line" /><small>Add recipients who are not in the student list.</small>
          {duplicateNames && <p className="form-error" role="alert">Remove duplicate names from the additional recipients.</p>}
          {invalidName && <p className="form-error" role="alert">Use names of up to 180 characters, without control characters.</p>}
          {count > maxBulkCertificateRecipients && <p className="form-error" role="alert">Choose up to {maxBulkCertificateRecipients} recipients per batch.</p>}
          <p className="certificate-disclosure">Anyone with a QR link can view that recipient’s name, certificate ID, title and issue time. Selected students keep their own certificates even when names are identical.</p>
          <button type="submit" className="primary-button certificate-submit" disabled={!template || loadingTemplate || !count || count > maxBulkCertificateRecipients || duplicateNames || invalidName}>{busy === 'issue' ? `Issuing ${count} certificates…` : result ? 'Batch issued' : `Issue ${count || ''} certificate${count === 1 ? '' : 's'}`}</button>
        </fieldset>
        {result && <button type="button" className="secondary-button certificate-submit" disabled={Boolean(busy)} onClick={startAnother}>Start another batch</button>}
      </form>
      <div className="certificate-preview-panel">{loadingTemplate ? <p role="status">Loading design…</p> : renderPreview(result?.template || template, previewName, previewCertificate)}{!result && <p className="certificate-bulk-preview-note">Preview of one recipient. Every selected recipient gets a different ID and QR code when issued.</p>}</div>
    </div>
    {result && <section className="admin-panel certificate-bulk-results" aria-labelledby="bulk-results-title">
      <div className="admin-section-heading"><div><span className="certificate-status verified">Batch saved</span><h2 id="bulk-results-title">{result.certificates.length} certificates issued</h2><p>Each record has its own certificate ID and verification QR code.</p></div><button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => download()}>{busy === 'download-all' ? `Preparing ${progress} / ${result.certificates.length}…` : 'Download all (PDF)'}</button></div>
      <p className="certificate-disclosure" role="status">The combined PDF contains one certificate per page. Individual PDFs are also available below and in Issued certificates.</p>
      <div className="certificate-table-scroll"><table><thead><tr><th>Recipient</th><th>Unique certificate ID</th><th>Actions</th></tr></thead><tbody>{result.certificates.map(certificate => <tr key={certificate.id}><td><strong>{certificate.recipientName}</strong></td><td className="certificate-monospace">{certificate.id}</td><td><div className="certificate-row-actions"><button type="button" disabled={Boolean(busy)} onClick={() => setPreviewId(certificate.id)}>Preview</button><button type="button" disabled={Boolean(busy)} onClick={() => download(certificate)}>PDF</button><a href={certificate.verificationUrl} target="_blank" rel="noopener noreferrer">Verify ↗</a></div></td></tr>)}</tbody></table></div>
    </section>}
  </div>;
}
