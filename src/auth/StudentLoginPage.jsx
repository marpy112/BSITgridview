import LoginPage from './LoginPage.jsx';

export default function StudentLoginPage({ onLogin }) {
  return <LoginPage role="student" onLogin={onLogin} />;
}
