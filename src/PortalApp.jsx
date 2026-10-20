import { useEffect, useRef, useState } from 'react';
import StudentPortal from './App.jsx';
import AdminDashboard from './admin/AdminDashboard.jsx';
import StudentLoginPage from './auth/StudentLoginPage.jsx';
import AdminLoginPage from './auth/AdminLoginPage.jsx';
import ChangePasswordPage from './auth/ChangePasswordPage.jsx';
import './portal.css';
import { apiRequest, mergeStudents } from './api.js';
import { defaultAcademicTerm } from '../shared/academic.js';

function initialRoute() {
  if (typeof window === 'undefined') return '/student/login';
  return window.location.hash.slice(1) || (/^\/login\/?$/.test(window.location.pathname) ? '/admin/login' : '/student/login');
}

export default function PortalApp() {
  const [route, setRoute] = useState(initialRoute);
  const [role, setRole] = useState(null);
  const [students, setStudents] = useState([]);
  const [activity, setActivity] = useState([]);
  const [instructors, setInstructors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState('');
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [academicTerm,setAcademicTerm] = useState(defaultAcademicTerm);
  const lastFullSnapshotAt = useRef(0);

  function applySnapshot(data) {
    setRole(data.role);
    setStudents(previous => mergeStudents(previous, data));
    if (!data.partialStudents) lastFullSnapshotAt.current = Date.now();
    setActivity(data.activity);
    setInstructors(data.instructors || []);
    setMustChangePassword(Boolean(data.mustChangePassword));
    if (data.academicTerm) setAcademicTerm(data.academicTerm);
  }

  useEffect(() => {
    let active = true;
    apiRequest('/api/session').then(data => {
      if (!active) return;
      applySnapshot(data);
      if (data.mustChangePassword) navigate('/student/change-password');
      else if (initialRoute().endsWith('/login')) navigate(data.role === 'admin' ? '/admin/dashboard' : '/student/progress');
    }).catch(error => { if (active && error.status !== 401) setConnectionError(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const sync = () => setRoute(initialRoute());
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); };
  }, []);

  useEffect(() => {
    if (!role || mustChangePassword) return;
    let active = true;
    let refreshing = false;
    async function refresh() {
      if (document.visibilityState === 'hidden' || refreshing || Date.now() - lastFullSnapshotAt.current < 60000) return;
      refreshing = true;
      try {
        const data = await apiRequest('/api/session');
        if (active) applySnapshot(data);
      } catch(error) {
        if (active && error.status === 401) {
          setRole(null); setStudents([]); setActivity([]); setInstructors([]);
          navigate(role === 'admin' ? '/admin/login' : '/student/login');
        }
      } finally { refreshing = false; }
    }
    window.addEventListener('focus',refresh);
    document.addEventListener('visibilitychange',refresh);
    return () => { active=false;window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh); };
  },[role,mustChangePassword]);

  useEffect(() => {
    const portal = route.startsWith('/admin') ? 'Administrator' : 'Student';
    const isLogin = route.endsWith('/login') || !role;
    document.title = `BSIT gradeview — ${portal} ${isLogin ? 'login' : 'portal'}`;
  }, [route, role]);

  function navigate(path) {
    if (path === '/admin/login') window.history.pushState(null, '', '/login/');
    else window.location.hash = path;
    setRoute(path);
    window.scrollTo({ top: 0 });
  }

  async function login(nextRole, identifier, password) {
    const data = await apiRequest('/api/login', { method: 'POST', body: JSON.stringify({ role: nextRole, identifier, password }) });
    applySnapshot(data);
    setConnectionError('');
    navigate(data.mustChangePassword ? '/student/change-password' : nextRole === 'admin' ? '/admin/dashboard' : '/student/progress');
  }

  async function logout() {
    try { await apiRequest('/api/logout', { method: 'POST' }); }
    catch (error) { if (error.status !== 401) { setConnectionError(error.message); return; } }
    const previousRole = role;
    setRole(null);
    setMustChangePassword(false);
    setStudents([]);
    setActivity([]);
    setInstructors([]);
    document.body.classList.remove('dark');
    navigate(previousRole === 'admin' ? '/admin/login' : '/student/login');
  }

  async function changePassword(newPassword, confirmPassword) {
    applySnapshot(await apiRequest('/api/change-password', { method: 'POST', body: JSON.stringify({ newPassword, confirmPassword }) }));
    navigate('/student/progress');
  }

  async function updateRecord(studentId, code, updates) {
    applySnapshot(await apiRequest(`/api/students/${encodeURIComponent(studentId)}/records/${encodeURIComponent(code)}`, { method: 'PATCH', body: JSON.stringify(updates) }));
  }

  async function startRetake(studentId, code, input) {
    applySnapshot(await apiRequest('/api/students/' + encodeURIComponent(studentId) + '/records/' + encodeURIComponent(code) + '/retake', { method: 'POST', body: JSON.stringify(input) }));
  }

  async function createStudent(input) {
    const data = await apiRequest('/api/students',{method:'POST',body:JSON.stringify(input)});
    applySnapshot(data);
    return data.createdStudentId;
  }

  async function updateStudent(id,input) {
    applySnapshot(await apiRequest(`/api/students/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(input)}));
  }

  async function createInstructor(input) {
    const data = await apiRequest('/api/instructors', { method: 'POST', body: JSON.stringify(input) });
    applySnapshot(data);
    return data.createdInstructorId;
  }

  async function resetStudentPassword(id) {
    applySnapshot(await apiRequest('/api/students/' + encodeURIComponent(id) + '/reset-password', {
      method: 'POST', body: JSON.stringify({ confirmStudentId: id }),
    }));
  }

  async function updateAcademicTerm(input,mode) {
    try {
      applySnapshot(await apiRequest('/api/academic-term',{method:mode==='advance'?'POST':'PATCH',body:JSON.stringify(input)}));
    } catch(error) {
      if(error.status===409) applySnapshot(await apiRequest('/api/session'));
      throw error;
    }
  }

  if (loading) return <div className="database-loading" role="status">Loading BSIT gradeview…</div>;
  if (role && connectionError) return <div className="database-loading"><p role="alert">{connectionError}</p><button className="primary-button" onClick={() => setConnectionError('')}>Return to portal</button></div>;
  if (role === 'student' && mustChangePassword) return <ChangePasswordPage onSave={changePassword} onLogout={logout} />;
  if (role === 'student' && !students[0]) return <div className="database-loading"><p role="alert">Your student profile could not be loaded. Please contact your administrator.</p><button className="primary-button" onClick={logout}>Sign out</button></div>;
  if (route.startsWith('/admin') && role === 'admin' && route !== '/admin/login') {
    return <AdminDashboard students={students} activity={activity} instructors={instructors} onCreateInstructor={createInstructor} onResetStudentPassword={resetStudentPassword} academicTerm={academicTerm} onCreateStudent={createStudent} onUpdateStudent={updateStudent} onUpdateAcademicTerm={updateAcademicTerm} onUpdateRecord={updateRecord} onStartRetake={startRetake} onLogout={logout} />;
  }
  if (route.startsWith('/student') && role === 'student' && route !== '/student/login') {
    return <StudentPortal currentCourses={students[0]?.courses || []} student={students[0]} academicTerm={academicTerm} onLogout={logout} />;
  }
  return route.startsWith('/admin') ? <AdminLoginPage onLogin={login} /> : <StudentLoginPage onLogin={login} />;
}
