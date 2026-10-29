const items = [
  { id: 'progress', label: 'Progress record', shortLabel: 'Progress' },
  { id: 'courses', label: 'My courses', shortLabel: 'Courses' },
  { id: 'certificates', label: 'Certificates', shortLabel: 'Certificates' },
  { id: 'profile', label: 'Student profile', shortLabel: 'Profile' },
];

function NavigationIcon({ page }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {page === 'progress' && <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>}
    {page === 'courses' && <><path d="M12 6c-2-2-6-3-9-2v15c3-1 7 0 9 2 2-2 6-3 9-2V4c-3-1-7 0-9 2Z" /><path d="M12 6v15M6 8h3M6 12h3M15 8h3M15 12h3" /></>}
    {page === 'certificates' && <><circle cx="12" cy="8" r="5" /><path d="m8.5 12-1 9 4.5-3 4.5 3-1-9" /><path d="m10 8 1.5 1.5L14 7" /></>}
    {page === 'profile' && <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>}
  </svg>;
}

export default function StudentNavigation({ page, onNavigate, certificateSummary }) {
  return <nav aria-label="Student navigation">
    {items.map(item => <button key={item.id} type="button" className={`nav-item ${page === item.id ? 'active' : ''}`} aria-current={page === item.id ? 'page' : undefined}
      aria-label={item.id === 'certificates' && certificateSummary ? `Certificates, ${certificateSummary.valid} valid` : item.label} onClick={() => onNavigate(item.id)}>
      <span className="student-nav-icon"><NavigationIcon page={item.id} /></span>
      <span className="student-nav-label">{item.label}</span><span className="student-nav-mobile-label">{item.shortLabel}</span>
      {item.id === 'certificates' && certificateSummary && <span className="student-certificate-nav-count" aria-hidden="true">{certificateSummary.valid}</span>}
    </button>)}
  </nav>;
}
