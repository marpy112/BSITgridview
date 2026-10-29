import { useEffect, useState } from 'react';
import { apiRequest } from '../api.js';
import { certificateIssuer, certificateTime } from '../../shared/certificates.js';
import { certificatePreview, certificateQr, downloadCertificate, renderCertificateDesign } from './pdf.js';
import './student-certificates.css';

function CertificateView({ detail, onClose, onDownload, busy }) {
  const [image, setImage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true; setImage(''); setError('');
    async function render() {
      const background = await renderCertificateDesign(detail.template);
      const qr = await certificateQr(detail.certificate.verificationUrl);
      return certificatePreview(background, detail.template.layout, detail.certificate.recipientName, detail.certificate.id, qr);
    }
    render().then(image => { if (active) setImage(image); }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [detail]);
  return <section className="student-certificate-view" aria-labelledby="student-certificate-view-title">
    <div className="student-certificate-view-heading"><div><span className="eyebrow">YOUR CERTIFICATE</span><h2 id="student-certificate-view-title">{detail.certificate.title}</h2><p>{detail.certificate.recipientName}</p></div><button type="button" className="secondary-button" onClick={onClose}>Close preview</button></div>
    {error ? <p className="form-error" role="alert">{error}</p> : image ? <img src={image} alt={`${detail.certificate.title} awarded to ${detail.certificate.recipientName}, certificate ID ${detail.certificate.id}`} /> : <p className="student-certificate-loading" role="status">Rendering your certificate…</p>}
    <div className="student-certificate-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => onDownload(detail.certificate)}>{busy ? 'Preparing…' : 'Download PDF'}</button><a className="secondary-button" href={detail.certificate.verificationUrl} target="_blank" rel="noopener noreferrer">Open verification ↗</a></div>
  </section>;
}

export default function StudentCertificates({ student, summary, onSummary }) {
  const [certificates, setCertificates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== 'hidden') setRevision(value => value + 1); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    apiRequest(`/api/my/certificates?page=${page}`).then(data => {
      if (active) { setCertificates(data.certificates); setHasMore(data.hasMore); onSummary(data.summary); }
    }).catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, revision, student.id, onSummary]);

  async function view(certificate) {
    setBusy(certificate.id); setError('');
    try { setDetail(await apiRequest(`/api/my/certificates/${encodeURIComponent(certificate.id)}`)); }
    catch (error) { setError(error.message); if (error.status === 410 || error.status === 404) setRevision(value => value + 1); }
    finally { setBusy(''); }
  }
  async function download(certificate) {
    setBusy(certificate.id); setError('');
    try {
      // Recheck ownership and revocation for every download, including an already open preview.
      const data = await apiRequest(`/api/my/certificates/${encodeURIComponent(certificate.id)}`);
      await downloadCertificate(data.template, data.certificate);
    } catch (error) { setError(error.message); if (error.status === 410 || error.status === 404) { setDetail(null); setRevision(value => value + 1); } }
    finally { setBusy(''); }
  }
  return <div className="student-certificates">
    <div className="page-heading"><div><div className="eyebrow">YOUR ACHIEVEMENTS</div><h1>My certificates<span>.</span></h1><p>View your department-issued certificates and download a copy.</p></div><button type="button" className="secondary-button" disabled={loading || Boolean(busy)} onClick={() => { setDetail(null); setRevision(value => value + 1); }}>Refresh</button></div>
    <section className="student-certificate-summary"><span className="student-certificate-medal" aria-hidden="true">✦</span><div><strong>{summary?.valid ? 'Certificate holder' : 'Your recognition starts here'}</strong><p>{summary?.valid ? `${summary.valid} verified certificate${summary.valid === 1 ? '' : 's'} earned by ${student.name}` : 'Certificates awarded to your student account will appear here.'}</p></div><span className="student-certificate-total">{summary?.valid ?? '—'}<small>valid certificates</small></span></section>
    {error && <div className="student-certificate-error" role="alert">{error}<button type="button" className="secondary-button" onClick={() => setRevision(value => value + 1)}>Try again</button></div>}
    {detail && <CertificateView detail={detail} onClose={() => setDetail(null)} onDownload={download} busy={Boolean(busy)} />}
    {loading ? <p className="student-certificate-loading" role="status">Loading your certificates…</p> : !certificates.length ? <section className="student-certificate-empty"><span aria-hidden="true">▧</span><h2>No certificates yet</h2><p>When the department issues a certificate to you, you can view and download it from this tab.</p></section> : <div className="student-certificate-grid">{certificates.map(certificate => <article className={`student-certificate-card ${certificate.status === 'revoked' ? 'is-revoked' : ''}`} key={certificate.id}>
      <div className="student-certificate-card-top"><span className="student-certificate-medal" aria-hidden="true">✦</span><span className={`student-certificate-status ${certificate.status}`}>{certificate.status === 'verified' ? 'Verified certificate' : 'Revoked'}</span></div>
      <h2>{certificate.title}</h2><p className="student-certificate-recipient">Awarded to <strong>{certificate.recipientName}</strong></p><p className="student-certificate-issuer">{certificateIssuer}</p>
      <dl><div><dt>Certificate ID</dt><dd className="student-certificate-id">{certificate.id}</dd></div><div><dt>Date and time obtained</dt><dd>{certificateTime(certificate.issuedAt)}<small>Philippine Standard Time (UTC+8)</small></dd></div></dl>
      <div className="student-certificate-actions">{certificate.status === 'verified' ? <><button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => view(certificate)}>View certificate</button><button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => download(certificate)}>{busy === certificate.id ? 'Preparing…' : 'Download PDF'}</button></> : <p className="student-certificate-revoked-note">This certificate is no longer valid. Contact the department if you need help.</p>}<a href={certificate.verificationUrl} target="_blank" rel="noopener noreferrer">Verify ↗</a></div>
    </article>)}</div>}
    {(page > 1 || hasMore) && <div className="student-certificate-pagination"><button type="button" className="secondary-button" disabled={page === 1 || loading || Boolean(busy)} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page}</span><button type="button" className="secondary-button" disabled={!hasMore || loading || Boolean(busy)} onClick={() => setPage(value => value + 1)}>Next</button></div>}
  </div>;
}
