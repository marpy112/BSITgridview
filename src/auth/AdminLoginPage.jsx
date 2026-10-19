import LoginPage from './LoginPage.jsx';

export default function AdminLoginPage({ onLogin }) {
  return <LoginPage role="admin" onLogin={onLogin} />;
}
