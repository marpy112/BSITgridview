const paths = {
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  students: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M21 21v-2a6 6 0 0 0-4-5.66" /></>,
  courses: <><path d="M4 4h6a3 3 0 0 1 2 1 3 3 0 0 1 2-1h6v16h-6a3 3 0 0 0-2 1 3 3 0 0 0-2-1H4zM12 5v16" /></>,
  instructors: <><circle cx="12" cy="7" r="4" /><path d="M5 21v-3a7 7 0 0 1 14 0v3M9 21v-5l3 2 3-2v5" /></>,
  certificates: <><rect x="4" y="3" width="16" height="14" rx="2" /><path d="M8 7h8M8 11h3M12 17v5l3-2 3 2v-5" /><circle cx="15" cy="14" r="3" /></>,
  'deans-list': <><circle cx="12" cy="8" r="5" /><path d="m8 12-2 9 6-3 6 3-2-9M10 8l1.5 1.5L14 6" /></>,
  search: <><circle cx="10.5" cy="10.5" r="7" /><path d="m16 16 5 5" /></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  check: <path d="m5 12 4 4L19 6" />,
  alert: <><path d="m12 3 10 18H2zM12 9v4M12 17h.01" /></>,
};

export default function AdminIcon({ name, className = '' }) {
  return <svg className={`admin-icon ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.dashboard}</svg>;
}
