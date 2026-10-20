import { useState } from 'react';

export default function LoginPage({ role, onLogin }) {
  const admin = role === 'admin';
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try { await onLogin(role, identifier, password); }
    catch (error) { setError(error.message); }
    finally { setSubmitting(false); }
  }

  return (
    <div className={`login-layout ${admin ? 'admin-login-page' : 'student-login-page'}`}>
      <section className="login-story">
        <a href={admin ? '/login/' : '/#/student/login'} className="brand login-brand"><span className="brand-icon">g<span>•</span></span><span className="brand-name"><small>BSIT </small>gradeview</span><span className="brand-dot">.</span></a>
        <div className="login-story-content">
          <div className="eyebrow">PORTAL NI SA MGA BATOS NI SIR MAKI</div>
          <h1>{admin ? <>Support every student.<br />See the bigger picture.</> : <> Imong Grado <br /> Imo na ng problema</>}</h1>
          <p>{admin ? 'Bring student records, course progress, and academic updates together in one thoughtful workspace.' : 'Dapat kompleto ang grado para permahan nako sa clearance - Maki'}</p>
        </div>
        <div className="login-story-footer">Built around your academic journey.</div>
      </section>
      <section className="login-form-side">
        <div className="login-top-note"><span className="portal-status"><i /> BSIT gradeview</span><span>{admin ? 'Administrator portal' : 'Student portal'}</span></div>
        <div className="login-form-wrap">
          <span className="login-page-badge">{admin ? 'Academic administration' : 'Student workspace'}</span>
          <div className="eyebrow">{admin ? 'ADMINISTRATOR PORTAL' : 'STUDENT PORTAL'}</div>
          <h2>{admin ? 'Administrator login' : 'Student login'}<span>.</span></h2>
          <p className="login-description">{admin ? 'Sign in to manage student progress records.' : 'Sign in to see how far you’ve come.'}</p>
          <form onSubmit={submit}>
            <label htmlFor="identifier">{admin ? 'Admin email' : 'Student ID'}</label>
            <input id="identifier" type={admin ? 'email' : 'text'} autoComplete="username" value={identifier} onChange={event => { setIdentifier(event.target.value); setError(''); }} placeholder={admin ? 'Your administrator email' : 'Enter your student ID'} required aria-describedby={error ? 'login-error' : undefined} aria-invalid={Boolean(error)} />
            <label htmlFor="password">Password</label>
            {!admin && <p className="initial-password-hint">First sign-in: use your student ID and your last name exactly as printed in the master list, including capital letters and spaces. You will be asked to choose a new password.</p>}
            <div className="password-field"><input id="password" type={visible ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={event => { setPassword(event.target.value); setError(''); }} placeholder="Enter your password" required /><button type="button" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible(!visible)}>{visible ? 'Hide' : 'Show'}</button></div>
            {error && <p className="form-error" id="login-error" role="alert">{error}</p>}
            <button className="primary-button login-submit" type="submit" disabled={submitting} aria-busy={submitting}>{submitting ? "Signing in..." : `Sign in as ${admin ? 'administrator' : 'student'}`} <span>→</span></button>
          </form>
          <p className="prototype-note">Sign in using the account provided by your academic administrator.</p>
          {admin && <p className="other-login-link">Looking for your progress record? <a href="/#/student/login">Student login <span aria-hidden="true">→</span></a></p>}
        </div>
        <div className="login-bottom-note">BSIT gradeview. <span>A little progress, every day.</span></div>
      </section>
    </div>
  );
}
