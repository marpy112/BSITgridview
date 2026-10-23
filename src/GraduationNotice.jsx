import { courses } from './data.js';
import { graduationProgress } from '../shared/graduation.js';
import './graduation.css';

export function graduationState(student) {
  return student.graduation || graduationProgress(student.courses || [], courses.map(course => course.code));
}

export default function GraduationNotice({ student, onApprove, disabled = false, unsaved = false }) {
  const progress = graduationState(student);
  const graduated = student.studentStatus === 'Graduated';
  if (!graduated && !progress.eligible) return null;
  return <section className={`graduation-notice${graduated ? ' graduation-approved' : ''}`} role="status" aria-label={graduated ? 'Graduation status' : 'Graduation eligibility'}>
    <span className="graduation-icon" aria-hidden="true">{graduated ? '✓' : '✦'}</span>
    <div><h2>{graduated ? 'Graduation approved' : onApprove ? 'Ready for graduation approval' : 'You can proceed to graduation'}</h2>
      <p>{graduated ? (onApprove ? 'This student’s status is Graduated.' : 'Your student status is now Graduated.') : `${progress.completed} of ${progress.required} required courses have passing grades. ${onApprove ? 'Review the completed record and approve the status change.' : 'Awaiting administrator approval to change your status to Graduated.'}`}</p>
      {!graduated && onApprove && unsaved && <p>Save or discard your course changes before approving graduation.</p>}
    </div>
    {!graduated && onApprove && <button className="primary-button" disabled={disabled || unsaved} onClick={onApprove}>Review graduation</button>}
  </section>;
}

export function GraduationQueue({ students, onReview, onViewAll }) {
  const eligible = students.filter(student => student.studentStatus !== 'Graduated' && graduationState(student).eligible);
  if (!eligible.length) return null;
  return <section className="graduation-queue admin-panel" aria-label="Graduation notifications">
    <div className="admin-section-heading"><div><h2>Graduation approvals <span className="count-pill">{eligible.length}</span></h2><p>These students have passed all required courses and can proceed to graduation after your approval.</p></div><button className="secondary-button" onClick={onViewAll}>View all eligible students</button></div>
    <ul>{eligible.slice(0, 5).map(student => <li key={student.id}><div><strong>{student.name}</strong><span>{student.id} · Awaiting approval</span></div><button className="secondary-button" onClick={() => onReview(student)}>Review record</button></li>)}</ul>
  </section>;
}
