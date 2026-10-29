import { useEffect, useState } from 'react';
import { apiRequest } from '../api.js';
import { certificateIssuer, certificateTime } from '../../shared/certificates.js';
import './certificates.css';

export default function VerificationPage({ token }) {
  const [state, setState] = useState({ loading: true });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setState({ loading: true });
    if (!/^[a-f0-9]{32}$/.test(token)) { setState({ missing: true, error: 'The certificate verification link is incomplete or invalid.' }); return; }
    apiRequest(`/api/certificates/verify/${token}`).then(data => { if (active) setState({ certificate: data.certificate }); })
      .catch(error => { if (active) setState({ error: error.message, missing: error.status === 404 }); });
    return () => { active = false; };
  }, [token, attempt]);
  const certificate = state.certificate;
  const verified = certificate?.status === 'verified';
  return <main className="certificate-verification">
    <div className="verification-brand"><span aria-hidden="true">IT</span><div><strong>IBACMI</strong><small>Department of Information Technology</small></div></div>
    <section className={`verification-card ${certificate && !verified ? 'is-revoked' : ''}`} aria-labelledby="verification-title">
      {state.loading ? <div role="status"><div className="verification-emblem" aria-hidden="true">…</div><h1 id="verification-title">Checking certificate</h1><p>Retrieving the issuing department’s record.</p></div> : certificate ? <>
        <div className="verification-emblem" aria-hidden="true">{verified ? '✓' : '!'}</div>
        <div className="verification-status">{verified ? 'AUTHENTICITY CONFIRMED' : 'CERTIFICATE REVOKED'}</div>
        <h1 id="verification-title">{verified ? 'Verified certificate' : 'This certificate is no longer valid'}</h1>
        <p>{verified ? 'This certificate was issued by' : 'This certificate has been revoked by'}<br /><strong>{certificateIssuer}</strong>.</p>
        <dl className="verification-details">
          <div><dt>Recipient name</dt><dd className="verification-recipient">{certificate.recipientName}</dd></div>
          <div><dt>Certificate</dt><dd>{certificate.title}</dd></div>
          <div><dt>Certificate ID No.</dt><dd className="certificate-monospace">{certificate.id}</dd></div>
          <div><dt>Date and time obtained</dt><dd><time dateTime={certificate.issuedAt}>{certificateTime(certificate.issuedAt)}</time><small>Philippine Standard Time (UTC+8) · Recorded on issuance</small></dd></div>
          {certificate.revokedAt && <div><dt>Revoked on</dt><dd>{certificateTime(certificate.revokedAt)} (UTC+8)</dd></div>}
        </dl>
        <p className="verification-footnote">Match the recipient name and certificate ID above with the certificate presented to you.</p>
      </> : <div role="alert"><div className="verification-emblem verification-error" aria-hidden="true">!</div><h1 id="verification-title">{state.missing ? 'Certificate not found' : 'Unable to verify right now'}</h1><p>{state.error}</p>{!state.missing && <button className="primary-button" onClick={() => setAttempt(value => value + 1)}>Try again</button>}<p className="verification-footnote">Contact the IBACMI Department of Information Technology if you need help with this certificate.</p></div>}
    </section>
    <p className="verification-footer">IBACMI · Official e-certificate verification</p>
  </main>;
}
