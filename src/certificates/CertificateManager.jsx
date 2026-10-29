import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api.js';
import { certificateIssuer, certificateTime, certificateVerificationUrl, defaultCertificateLayout, validCertificateLayout, clampCertificateLayout as clampLayout } from '../../shared/certificates.js';
import { certificatePreview, certificateQr, downloadCertificate, readCertificateJpeg, renderCertificateDesign } from './pdf.js';
import PlacementControls, { PlacementCanvas } from './PlacementControls.jsx';
import BulkCertificateIssuer from './BulkCertificateIssuer.jsx';
import LinkStudentDialog from './LinkStudentDialog.jsx';
import './certificates.css';

const freshLayout = () => structuredClone(defaultCertificateLayout);
const sampleId = `IBACMI-IT-${new Date().getFullYear()}-0123456789AB`;
function Preview({ template, name = 'Recipient Name', certificate, element, onSelect, onMove }) {
  const [background, setBackground] = useState('');
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const dragRef = useRef(null);
  useEffect(() => {
    let active = true;
    setBackground(''); setPreview(''); setError('');
    if (!template?.pdfBase64 && !template?.jpegBase64) return;
    renderCertificateDesign(template).then(result => { if (active) setBackground(result); }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [template?.pdfBase64, template?.jpegBase64]);
  useEffect(() => {
    let active = true;
    if (!background || !template) return;
    const timer = window.setTimeout(async () => {
      try {
        const url = certificate?.verificationUrl || certificateVerificationUrl(window.location.origin, certificate?.token || '00000000000000000000000000000000');
        const qr = await certificateQr(url);
        const image = await certificatePreview(background, template.layout, name.trim() || 'Recipient Name', certificate?.id || sampleId, qr);
        if (active) { setPreview(image); setError(''); }
      } catch (error) { if (active) setError(error.message); }
    }, 120);
    return () => { active = false; window.clearTimeout(timer); };
  }, [background, template, name, certificate]);
  if (error) return <div className="certificate-preview-placeholder" role="alert">{error}</div>;
  if (!template) return <div className="certificate-preview-placeholder"><span aria-hidden="true">▧</span><strong>Your certificate preview</strong><p>Choose a JPEG design to see the recipient’s name, ID and QR code in place.</p></div>;
  return <figure className="certificate-preview">
    <div className="certificate-preview-heading"><span>{certificate ? 'ISSUED CERTIFICATE' : 'LIVE PREVIEW'}</span>{!certificate && <small>Sample ID and QR code</small>}</div>
    {preview ? onMove ? <PlacementCanvas preview={preview} template={template} element={element} onSelect={onSelect} onMove={onMove} dragRef={dragRef} /> : <img src={preview} alt={`Certificate preview for ${name}`} /> : <div className="certificate-preview-placeholder" role="status">Rendering certificate design…</div>}
    <figcaption>{onMove ? 'Drag the QR code, certificate ID or recipient name to move it. Arrow keys move a selected element; Shift + arrow moves farther.' : 'The citation and signature come from your uploaded design.'}</figcaption>
  </figure>;
}

export default function CertificateManager({ students = [] }) {
  const [tab, setTab] = useState('issue');
  const [templates, setTemplates] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(null);
  const [title, setTitle] = useState('');
  const [element, setElement] = useState('name');
  const [recipient, setRecipient] = useState('');
  const [recipientStudentId, setRecipientStudentId] = useState('');
  const isOtherRecipient = recipientStudentId === '__other__';
  const isStudentRecipient = Boolean(recipientStudentId) && !isOtherRecipient;
  const matchingStudentAccounts = isOtherRecipient && recipient.trim() ? students.filter(student =>
    student.name.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase() === recipient.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()) : [];
  const [linkingCertificate, setLinkingCertificate] = useState(null);
  const [records, setRecords] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [issued, setIssued] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingTemplate, setLoadingTemplate] = useState(false);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const cache = useRef(new Map());
  const uploadRef = useRef(null);

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    apiRequest('/api/certificate-templates').then(data => {
      if (active) { setTemplates(data.templates); setSelectedId(current => current || data.templates[0]?.id || ''); }
    }).catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);

  useEffect(() => {
    let active = true;
    setSelected(null);
    if (!selectedId) return;
    setLoadingTemplate(true);
    const cached = cache.current.get(selectedId);
    (cached ? Promise.resolve({ template: cached }) : apiRequest(`/api/certificate-templates/${selectedId}`)).then(data => {
      if (active) { cache.current.set(selectedId, data.template); setSelected(data.template); }
    }).catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoadingTemplate(false); });
    return () => { active = false; };
  }, [selectedId]);

  useEffect(() => {
    if (tab !== 'registry') return;
    let active = true;
    setLoadingRecords(true); setError('');
    apiRequest(`/api/certificates?page=${page}`).then(data => { if (active) { setRecords(data.certificates); setHasMore(data.hasMore); } })
      .catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoadingRecords(false); });
    return () => { active = false; };
  }, [tab, page, retry]);

  function changeTab(next) { if (!busy) { setTab(next); setError(''); setNotice(''); } }
  async function upload(file) {
    if (!file) return;
    setBusy('upload'); setError(''); setNotice('');
    try {
      const image = await readCertificateJpeg(file);
      setDraft({ ...image, layout: clampLayout(freshLayout(), image.width, image.height), filename: file.name });
      setTitle(file.name.replace(/\.jpe?g$/i, '').replaceAll('_', ' ').slice(0, 180));
    } catch (error) { setError(error.message); }
    finally { setBusy(''); if (uploadRef.current) uploadRef.current.value = ''; }
  }
  function updatePlacement(values, target = element) {
    setDraft(current => ({ ...current, layout: clampLayout({ ...current.layout, [target]: { ...current.layout[target], ...values } }, current.width, current.height) }));
  }
  async function customizeDesign(id) {
    if (draft && !window.confirm('Replace your unsaved design with this saved design?')) return;
    setBusy('customize'); setError(''); setNotice('');
    try {
      const design = cache.current.get(id) || (await apiRequest(`/api/certificate-templates/${id}`)).template;
      cache.current.set(id, design);
      setDraft({ ...design, layout: structuredClone(design.layout), sourceTemplateId: design.id, filename: design.title });
      setTitle(`${design.title.replace(/ \(custom placement\)$/, '').slice(0, 160)} (custom placement)`);
      setElement('qr'); setTab('designs'); setIssued(null);
      setNotice('Adjust the QR code and certificate ID below. Saving creates a new design for future certificates.');
    } catch (error) { setError(error.message); }
    finally { setBusy(''); }
  }
  async function saveDesign(event) {
    event.preventDefault(); setBusy('save'); setError(''); setNotice('');
    try {
      const data = await apiRequest('/api/certificate-templates', { method: 'POST', body: JSON.stringify({ title, layout: draft.layout,
        ...(draft.sourceTemplateId ? { sourceTemplateId: draft.sourceTemplateId } : { jpegBase64: draft.jpegBase64 }),
      }) });
      cache.current.set(data.template.id, data.template);
      setTemplates(current => [data.template, ...current]); setSelectedId(data.template.id); setSelected(data.template);
      setDraft(null); setTitle(''); setTab('issue'); setIssued(null);
      setNotice('Certificate design saved. Enter a recipient to issue your first certificate.');
    } catch (error) { setError(error.message); }
    finally { setBusy(''); }
  }
  async function issue(event) {
    event.preventDefault();
    if (!recipientStudentId) { setError('Choose a student account or explicitly select an outside recipient.'); return; }
    setBusy('issue'); setError(''); setNotice('');
    try {
      const data = await apiRequest('/api/certificates', { method: 'POST', body: JSON.stringify({ templateId: selectedId,
        ...(isStudentRecipient ? { studentId: recipientStudentId } : { recipientName: recipient }),
      }) });
      setIssued({ certificate: data.certificate, template: selected });
      setNotice(data.certificate.studentId ? 'Certificate issued and added to the student’s Certificates tab. Download the PDF below.' : 'Certificate issued without a student account. It will not appear in a student portal until you link an account from Issued certificates.');
    } catch (error) { setError(error.message); }
    finally { setBusy(''); }
  }
  async function download(certificate, template) {
    setBusy(`download:${certificate.id}`); setError('');
    try {
      let design = template || cache.current.get(certificate.templateId);
      if (!design) {
        design = (await apiRequest(`/api/certificate-templates/${certificate.templateId}`)).template;
        cache.current.set(design.id, design);
      }
      await downloadCertificate(design, certificate);
    } catch (error) { setError(`The certificate is saved, but the PDF could not be downloaded. ${error.message}`); }
    finally { setBusy(''); }
  }
  async function linkStudent(certificate, studentId) {
    setBusy('link');
    try {
      await apiRequest(`/api/certificates/${certificate.id}/student`, { method: 'PATCH', body: JSON.stringify({ studentId, expectedStudentId: certificate.studentId || null }) });
      setNotice('Student account linked. This certificate is now listed in that student’s Certificates tab.');
      setRetry(value => value + 1);
    } finally { setBusy(''); }
  }
  async function revoke(certificate) {
    if (!window.confirm(`Revoke ${certificate.id} issued to ${certificate.recipientName}? Its verification page will show that it is no longer valid.`)) return;
    setBusy(`revoke:${certificate.id}`); setError(''); setNotice('');
    try {
      await apiRequest(`/api/certificates/${certificate.id}/revoke`, { method: 'POST', body: '{}' });
      if (issued?.certificate.id === certificate.id) setIssued(null);
      setNotice('Certificate revoked. Its QR link now shows the revoked status.'); setRetry(value => value + 1);
    } catch (error) { setError(error.message); }
    finally { setBusy(''); }
  }
  return <section className="certificate-manager">
    <div className="certificate-intro"><span className="certificate-intro-icon" aria-hidden="true">▧</span><div><strong>Recognition, with a record.</strong><p>Issue certificates from your own design. Every QR code links to a permanent verification record.</p></div><span className="certificate-issuer-tag">IBACMI · Information Technology</span></div>
    <div className="certificate-tabs" role="group" aria-label="Certificate workspace">{[['issue', 'Issue certificate'], ['bulk', 'Bulk issuance'], ['designs', 'Certificate designs'], ['registry', 'Issued certificates']].map(([id, label]) => <button key={id} type="button" aria-pressed={tab === id} disabled={Boolean(busy)} className={tab === id ? 'active' : ''} onClick={() => changeTab(id)}>{label}</button>)}</div>
    {error && <div className="certificate-feedback is-error" role="alert">{error}<button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => setRetry(value => value + 1)}>Retry loading</button></div>}
    {notice && <p className="certificate-feedback" role="status">{notice}</p>}
    {loading ? <div className="admin-panel empty" role="status">Loading certificate workspace…</div> : <>
      {tab === 'issue' && (!templates.length ? <div className="admin-panel certificate-empty"><span aria-hidden="true">▧</span><h2>Add your first certificate design</h2><p>Upload a JPEG with your citation and signature included. Leave room for the recipient name, certificate ID and QR code.</p><button className="primary-button" onClick={() => changeTab('designs')}>+ Add certificate design</button></div> : <>
        <div className="certificate-workspace"><form className="admin-panel certificate-form" onSubmit={issue}><div className="eyebrow">ISSUE AN E-CERTIFICATE</div><h2>Award a certificate</h2><p>The recipient name, certificate ID and QR code are added automatically to the saved design.</p><fieldset disabled={Boolean(busy)}>
          <label htmlFor="certificate-design">Certificate design</label><select id="certificate-design" value={selectedId} onChange={event => { setSelectedId(event.target.value); setIssued(null); }} required>{templates.map(template => <option key={template.id} value={template.id}>{template.title}</option>)}</select>
          <button type="button" className="secondary-button certificate-customize-button" disabled={!selected || loadingTemplate} onClick={() => customizeDesign(selectedId)}>Customize QR &amp; ID placement</button>
          <label htmlFor="certificate-student-account">Student account</label><select id="certificate-student-account" required value={recipientStudentId} onChange={event => { const id = event.target.value; setRecipientStudentId(id); setRecipient(students.find(student => student.id === id)?.name || ''); setIssued(null); }}><option value="" disabled>Choose a student account</option><option value="__other__">Outside recipient (no student account)</option>{students.map(student => <option key={student.id} value={student.id}>{student.name} &middot; {student.id}</option>)}</select><small>Select a student to add the certificate to their account.</small>
          <label htmlFor="certificate-recipient">Recipient name</label><input id="certificate-recipient" readOnly={!isOtherRecipient} value={recipient} onChange={event => { setRecipient(event.target.value); setIssued(null); }} required maxLength={180} placeholder="Enter the recipient's full name" />
          {isStudentRecipient && <p className="certificate-recipient-link-note" role="status">This certificate will appear in student account {recipientStudentId}.</p>}
          {isOtherRecipient && <div className="certificate-unlinked-warning"><strong>Outside recipient</strong><p>This certificate will not appear in a student account.</p>{matchingStudentAccounts.length > 0 && <><p>A student account matches this name. Select the correct student ID to add it to their portal.</p>{matchingStudentAccounts.map(student => <button key={student.id} type="button" className="secondary-button" onClick={() => { setRecipientStudentId(student.id); setRecipient(student.name); setIssued(null); }}>Use student account {student.id}</button>)}</>}</div>}
          <div className="certificate-auto-details"><span>GENERATED ON ISSUANCE</span><p>Unique certificate ID<br />Scannable verification QR code<br />Date and time obtained (Philippine time)</p></div>
          <p className="certificate-disclosure">Anyone with the QR link can view the recipient’s name, certificate title, ID and issue time.</p>
          <button className="primary-button certificate-submit" type="submit" disabled={!selected || loadingTemplate || !recipientStudentId || !recipient.trim() || Boolean(issued)}>{busy === 'issue' ? 'Issuing certificate…' : issued ? 'Certificate issued' : 'Issue certificate'}</button>
          {issued && <button className="secondary-button certificate-submit" type="button" onClick={() => { setIssued(null); setRecipient(''); setRecipientStudentId(''); setNotice(''); }}>Issue another certificate</button>}
        </fieldset></form><div className="certificate-preview-panel">{loadingTemplate ? <div className="certificate-preview-placeholder" role="status">Loading design…</div> : <Preview template={selected} name={recipient} certificate={issued?.certificate} />}</div></div>
        {issued && <section className="admin-panel certificate-issued" aria-label="Issued certificate details"><div><span className="certificate-status verified">Verified record saved</span><h2>{issued.certificate.recipientName}</h2><p className="certificate-monospace">{issued.certificate.id}</p><p>Obtained {certificateTime(issued.certificate.issuedAt)} (UTC+8)</p></div><div className="certificate-issued-actions"><button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => download(issued.certificate, issued.template)}>{busy.startsWith('download:') ? 'Preparing PDF…' : 'Download certificate PDF'}</button><a className="secondary-button" href={issued.certificate.verificationUrl} target="_blank" rel="noopener noreferrer">Open verification ↗</a></div></section>}
      </>)}
      {tab === 'bulk' && (templates.length ? <BulkCertificateIssuer students={students} templates={templates} template={selected} templateId={selectedId} loadingTemplate={loadingTemplate}
        onSelectTemplate={id => { setSelectedId(id); setIssued(null); }} onBusyChange={setBusy}
        renderPreview={(template, name, certificate) => <Preview template={template} name={name} certificate={certificate} />} /> : <div className="admin-panel certificate-empty"><h2>Add a certificate design first</h2><p>Save a design, then select multiple recipients to issue their certificates together.</p><button type="button" className="primary-button" onClick={() => changeTab('designs')}>+ Add certificate design</button></div>)}
      {tab === 'designs' && <>
        <div className="admin-panel certificate-design-list"><div className="admin-section-heading"><div><h2>Saved designs <span className="count-pill">{templates.length}</span></h2><p>Each design keeps its citation, signature and placement settings.</p></div></div>{templates.length > 0 && <div className="certificate-template-list">{templates.map(template => <div key={template.id}><span aria-hidden="true">▧</span><div><strong>{template.title}</strong><small>Added {certificateTime(template.createdAt)} (UTC+8)</small></div><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => customizeDesign(template.id)}>Customize placement</button><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => { setSelectedId(template.id); setIssued(null); changeTab('issue'); }}>Use design</button></div>)}</div>}</div>
        <div className="certificate-workspace"><form className="admin-panel certificate-form" onSubmit={saveDesign}><div className="eyebrow">NEW CERTIFICATE DESIGN</div><h2>{draft?.sourceTemplateId ? "Customize your design" : "Upload your JPEG"}</h2><p>Include the citation and signature in the design. Leave the recipient name, QR code and certificate ID blank.</p><fieldset disabled={Boolean(busy)}>
          <label className="certificate-upload" htmlFor="certificate-jpeg"><span aria-hidden="true">↑</span><strong>{draft?.filename || 'Choose a certificate JPEG'}</strong><small>.jpg or .jpeg · Up to 1 MB</small></label><input ref={uploadRef} id="certificate-jpeg" type="file" accept="image/jpeg,.jpg,.jpeg" onChange={event => upload(event.target.files?.[0])} />
          {busy === 'upload' && <p role="status">Opening JPEG…</p>}
          {draft && <><label htmlFor="certificate-title">Certificate title</label><input id="certificate-title" value={title} onChange={event => setTitle(event.target.value)} required maxLength={180} placeholder="e.g. Certificate of Participation — IT Seminar" /><small>This title also appears on the public verification page.</small>
            <PlacementControls template={draft} element={element} onSelect={setElement} onChange={updatePlacement} onReset={() => setDraft(current => ({ ...current, layout: clampLayout(freshLayout(), current.width, current.height) }))} />
            <p className="certificate-disclosure">Save the placement with this design. Previously issued certificates keep their original layout.</p>
            {!validCertificateLayout(draft.layout, draft.width, draft.height) && <p className="form-error">Keep all elements within the certificate. Use a standard portrait or landscape certificate size.</p>}
            <button type="submit" className="primary-button certificate-submit" disabled={!title.trim() || !validCertificateLayout(draft.layout, draft.width, draft.height)}>{busy === 'save' ? 'Saving design…' : draft.sourceTemplateId ? 'Save as new design' : 'Save certificate design'}</button></>}
        </fieldset></form><div className="certificate-preview-panel"><Preview template={draft} element={element} onSelect={setElement} onMove={draft && !busy ? (key, values) => updatePlacement(values, key) : undefined} /></div></div>
      </>}
      {tab === 'registry' && <section className="admin-panel certificate-registry"><div className="admin-section-heading"><div><h2>Issued certificates</h2><p>Download issued PDFs, open their verification records, or revoke an incorrect certificate.</p></div><button type="button" className="secondary-button" disabled={Boolean(busy) || loadingRecords} onClick={() => setRetry(value => value + 1)}>Refresh</button></div>{loadingRecords ? <p className="empty" role="status">Loading issued certificates…</p> : !records.length ? <div className="empty"><h3>No certificates issued yet</h3><p>Issue a certificate to create its verification record.</p></div> : <div className="certificate-table-scroll"><table><thead><tr><th>Recipient / certificate</th><th>Certificate ID No.</th><th>Obtained (UTC+8)</th><th>Status</th><th>Actions</th></tr></thead><tbody>{records.map(certificate => <tr key={certificate.id}><td><strong>{certificate.recipientName}</strong><small>{certificate.title}</small><small className="certificate-student-link">{certificate.studentId ? "Student account: " + certificate.studentId : "No student account linked"}</small></td><td className="certificate-monospace">{certificate.id}</td><td>{certificateTime(certificate.issuedAt)}</td><td><span className={`certificate-status ${certificate.status}`}>{certificate.status === 'verified' ? 'Valid' : 'Revoked'}</span></td><td><div className="certificate-row-actions"><button type="button" disabled={Boolean(busy)} onClick={() => setLinkingCertificate(certificate)}>{certificate.studentId ? "Change student" : "Link student"}</button><a href={certificate.verificationUrl || certificateVerificationUrl(window.location.origin, certificate.token)} target="_blank" rel="noopener noreferrer">Verify ↗</a>{certificate.status === 'verified' && <><button type="button" disabled={Boolean(busy)} onClick={() => download(certificate)}>PDF</button><button type="button" className="certificate-revoke" disabled={Boolean(busy)} onClick={() => revoke(certificate)}>Revoke</button></>}</div></td></tr>)}</tbody></table></div>}<div className="certificate-pagination"><button type="button" className="secondary-button" disabled={page === 1 || loadingRecords || Boolean(busy)} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page}</span><button type="button" className="secondary-button" disabled={!hasMore || loadingRecords || Boolean(busy)} onClick={() => setPage(value => value + 1)}>Next</button></div></section>}
    </>}
    <p className="certificate-department-note">Issued by {certificateIssuer}</p>
    {linkingCertificate && <LinkStudentDialog certificate={linkingCertificate} students={students} onSave={linkStudent} onClose={() => setLinkingCertificate(null)} />}
  </section>;
}
