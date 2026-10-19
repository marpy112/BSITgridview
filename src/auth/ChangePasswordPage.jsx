import { useState } from 'react';

export default function ChangePasswordPage({ onSave, onLogout }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    if (password !== confirmation) { setError('The new passwords do not match.'); return; }
    if (password.length < 12 || new TextEncoder().encode(password).length > 72) { setError('Use at least 12 characters and no more than 72 UTF-8 bytes.'); return; }
    setSaving(true);
    setError('');
    try { await onSave(password, confirmation); }
    catch (error) { setError(error.message); }
    finally { setSaving(false); }
  }
  return <div className="password-change-page"><section className="password-change-card">
    <a className="footer-brand" href="#/student/change-password">BSIT gradeview.</a>
    <span className="login-page-badge">First sign-in</span>
    <div className="eyebrow">SET YOUR PERSONAL PASSWORD</div>
    <h1>Make this account yours<span>.</span></h1>
    <p className="login-description">Replace your initial last-name password before viewing your progress record.</p>
    <form onSubmit={submit}>
      <label htmlFor="new-password">New password</label>
      <input id="new-password" type={show ? 'text' : 'password'} autoComplete="new-password" minLength={12} required value={password} onChange={event => setPassword(event.target.value)} aria-describedby="password-rules" />
      <label htmlFor="confirm-password">Confirm new password</label>
      <input id="confirm-password" type={show ? 'text' : 'password'} autoComplete="new-password" required value={confirmation} onChange={event => setConfirmation(event.target.value)} />
      <label className="password-show-option"><input type="checkbox" checked={show} onChange={event => setShow(event.target.checked)} />Show passwords</label>
      <p className="prototype-note" id="password-rules">Use at least 12 characters. A memorable phrase works well. Your new password must differ from the initial password.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button login-submit" disabled={saving} aria-busy={saving} type="submit">{saving ? 'Saving password…' : 'Save password and continue'}<span aria-hidden="true">→</span></button>
    </form>
    <button className="text-button" onClick={onLogout} disabled={saving}>Sign out</button>
  </section></div>;
}
