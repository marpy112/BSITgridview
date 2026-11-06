import { useMemo, useState } from 'react';
import { academicTermLabel } from '../../shared/academic.js';
import { graduationState, GraduationQueue } from '../GraduationNotice.jsx';
import ExportButton from '../ExportButton.jsx';
import AdminIcon from './AdminIcon.jsx';
import { recordStatuses, summarizeDashboard } from './dashboard-data.js';

const statusClasses = { Passed: 'passed', 'In progress': 'progress', Incomplete: 'incomplete', Failed: 'failed', 'Not taken': 'untaken' };
const number = value => value.toLocaleString();

export default function DashboardOverview({ students, activity = [], academicTerm, onOpenDirectory, onReviewStudent }) {
  const summary = useMemo(() => summarizeDashboard(students), [students]);
  const eligible = students.filter(student => student.studentStatus !== 'Graduated' && graduationState(student).eligible).length;
  const [search, setSearch] = useState('');
  const [showAllActivity, setShowAllActivity] = useState(false);
  const cards = [
    { label: 'Total students', value: students.length, note: `${students.filter(student => (student.studentStatus || 'Active') === 'Active').length} active profiles`, icon: 'students', tone: 'blue', filter: 'All students' },
    { label: 'Records passed', value: summary.counts.Passed, note: `${summary.percent}% of all curriculum records`, icon: 'check', tone: 'green', filter: 'With passed records' },
    { label: 'Students to follow up', value: summary.followUp, note: 'With incomplete or failed courses', icon: 'alert', tone: 'amber', filter: 'Needs follow-up' },
    { label: 'Graduation approvals', value: eligible, note: 'Ready for your review', icon: 'certificates', tone: 'purple', filter: 'Awaiting graduation approval' },
  ];

  return <div className="dashboard-content">
    <section className="dashboard-find" aria-labelledby="dashboard-find-title">
      <div><h2 id="dashboard-find-title">Which student can we help today?</h2><p>Find a record to review grades, track progress, or update details.</p></div>
      <form role="search" onSubmit={event => { event.preventDefault(); onOpenDirectory({ query: search.trim() }); }}>
        <label className="dashboard-search"><AdminIcon name="search" /><input aria-label="Find a student" placeholder="Search name or student number" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <button className="primary-button" type="submit">Find student <AdminIcon name="arrow" /></button>
      </form>
    </section>

    <section className="dashboard-metrics" aria-label="Academic overview">
      {cards.map(card => <button key={card.label} className={`dashboard-metric ${card.tone}`} onClick={() => onOpenDirectory({ filter: card.filter, page: card.page })}>
        <span className="dashboard-metric-top"><span className="dashboard-metric-icon"><AdminIcon name={card.icon} /></span><AdminIcon name="arrow" /></span>
        <span className="dashboard-metric-label">{card.label}</span><strong>{number(card.value)}</strong><small>{card.note}</small>
      </button>)}
    </section>

    <div className="dashboard-panels">
      <section className="admin-panel dashboard-attention" aria-labelledby="attention-title">
        <div className="admin-section-heading"><div><span className="dashboard-kicker">YOUR NEXT STEPS</span><h2 id="attention-title">Records to review</h2><p>Student counts across all academic years.</p></div><span className="dashboard-section-icon"><AdminIcon name="alert" /></span></div>
        <div className="dashboard-task-list">
          {[
            ['Incomplete grades', summary.incomplete, 'Check missing requirements and final grades.', 'amber'],
            ['Failed courses', summary.failed, 'Review results and retake options.', 'rose'],
            ['No recorded grades', summary.ungraded, 'Open a record to begin entering grades.', 'blue'],
          ].map(([label, count, detail, tone]) => <button className="dashboard-task" key={label} disabled={!count} onClick={() => onOpenDirectory({ filter: label })}>
            <span className={`dashboard-task-count ${tone}`}>{number(count)}</span><span><strong>{label}</strong><small>{detail}</small></span><AdminIcon name="arrow" />
          </button>)}
        </div><p className="dashboard-footnote">A student may appear in more than one review group.</p>
      </section>

      <section className="admin-panel dashboard-status" aria-labelledby="record-status-title">
        <div className="admin-section-heading"><div><span className="dashboard-kicker">CURRICULUM COVERAGE</span><h2 id="record-status-title">Record status</h2><p>All {number(summary.total)} assigned curriculum records, including future courses.</p></div></div>
        <div className="dashboard-status-total"><strong>{summary.percent}<span>%</span></strong><div>passed<small>{number(summary.counts.Passed)} of {number(summary.total)} records</small></div></div>
        <div className="dashboard-status-bar" role="img" aria-label={recordStatuses.map(status => `${status}: ${summary.counts[status]}`).join(', ')}>{recordStatuses.map(status => <span className={statusClasses[status]} key={status} style={{ width: `${summary.total ? summary.counts[status] / summary.total * 100 : 0}%` }} />)}</div>
        <ul className="dashboard-status-legend">{recordStatuses.map(status => <li key={status}><span><i className={statusClasses[status]} />{status}</span><strong>{number(summary.counts[status])}</strong></li>)}</ul>
      </section>
    </div>

    <GraduationQueue students={students} onReview={onReviewStudent} onViewAll={() => onOpenDirectory({ filter: 'Awaiting graduation approval' })} />

    <div className="dashboard-panels dashboard-lower-panels">
      <section className="admin-panel" aria-labelledby="year-progress-title">
        <div className="admin-section-heading"><div><h2 id="year-progress-title">Progress by student year</h2><p>Passed curriculum records for students in each year level.</p></div><ExportButton filename="curriculum-progress.pdf" description="curriculum progress by student year" headers={['Student year', 'Students', 'Passed records', 'All curriculum records', 'Passed percent']} rows={summary.cohorts.map(cohort => [cohort.year, cohort.students, cohort.passed, cohort.records, cohort.records ? Math.round(cohort.passed / cohort.records * 100) + '%' : '—'])} metadata={[`Active term: ${academicTermLabel(academicTerm)}`, 'Includes all academic years and future curriculum courses.']} /></div>
        <div className="dashboard-cohorts">{summary.cohorts.map(cohort => {
          const percent = cohort.records ? Math.round(cohort.passed / cohort.records * 100) : 0;
          return <button key={cohort.year} disabled={!cohort.students} onClick={() => onOpenDirectory({ year: String(cohort.year) })}>
            <span className="dashboard-cohort-label"><strong>Year {cohort.year}</strong><small>{number(cohort.students)} students</small></span><span className="dashboard-cohort-progress"><span className="dashboard-cohort-track"><span style={{ width: `${percent}%` }} /></span><small>{number(cohort.passed)} of {number(cohort.records)} records passed</small></span><strong className="dashboard-cohort-percent">{cohort.records ? `${percent}%` : '—'}</strong><AdminIcon name="arrow" />
          </button>;
        })}</div>
      </section>

      <section className="admin-panel dashboard-activity" aria-labelledby="updates-title">
        <div className="admin-section-heading"><div><h2 id="updates-title">Recent activity</h2><p>Latest saved record changes.</p></div><ExportButton filename="recent-record-updates.pdf" headers={['Student and course', 'Update']} rows={activity.map(item => [item.text, item.detail])} description="recent updates" /></div>
        {activity.length ? <><ul className="dashboard-activity-list">{(showAllActivity ? activity : activity.slice(0, 5)).map(item => <li key={item.id}><span className="dashboard-activity-icon"><AdminIcon name="check" /></span><div><strong>{item.text}</strong><p>{item.detail}</p></div></li>)}</ul>{activity.length > 5 && <button className="text-button" aria-expanded={showAllActivity} onClick={() => setShowAllActivity(value => !value)}>{showAllActivity ? 'Show fewer updates' : `Show all ${activity.length} updates`}</button>}</> : <div className="dashboard-empty"><AdminIcon name="courses" /><h3>No updates yet</h3><p>Saved grade changes will appear here.</p><button className="text-button" onClick={() => onOpenDirectory({})}>Open student directory <span aria-hidden="true">→</span></button></div>}
      </section>
    </div>
    <div className="dashboard-directory-link"><div><strong>Every student, one directory.</strong><p>Browse profiles, review grades, and manage student details.</p></div><button className="secondary-button" onClick={() => onOpenDirectory({})}>View all students <AdminIcon name="arrow" /></button></div>
  </div>;
}
