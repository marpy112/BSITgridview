import { nextRetakeTerm, retakeLabel } from '../shared/retakes.js';
import './retakes.css';

export function RetakeNote({ course }) {
  if (course.status === 'Failed') {
    const next = course.retake || nextRetakeTerm(course.academicYearTaken, course.semesterTaken);
    return <span className="retake-note">{next ? `Retake: ${retakeLabel(next)}` : 'Retake needed · Set the failed school year and semester.'}</span>;
  }
  if (course.attemptNumber > 1) return <span className="retake-note">Retake · Attempt {course.attemptNumber} · {retakeLabel({ schoolYear: course.academicYearTaken, semester: course.semesterTaken })}</span>;
  return null;
}

export function AttemptHistory({ course }) {
  if (!course.pastAttempts?.length) return null;
  return <details className="attempt-history"><summary>{course.pastAttempts.length} previous {course.pastAttempts.length === 1 ? 'attempt' : 'attempts'}</summary><ol>
    {course.pastAttempts.map(attempt => <li key={attempt.attemptNumber}><strong>Attempt {attempt.attemptNumber}: {attempt.grade.toFixed(2)} · {attempt.status}</strong><span>{retakeLabel({ schoolYear: attempt.academicYearTaken, semester: attempt.semesterTaken })}{attempt.transferSchool ? ` · ${attempt.transferSchool}` : ''}</span><span>{attempt.instructor}</span></li>)}
  </ol></details>;
}

export function StudentRetakes({ courses, onSelect, disabled = false }) {
  const items = courses.filter(course => course.status === 'Failed' || (course.attemptNumber > 1 && ['In progress', 'Incomplete'].includes(course.status)));
  if (!items.length) return null;
  return <section className="student-retakes"><div><h2>Course retakes <span>{items.length}</span></h2><p>Failed courses are retaken in the next school year, in the same semester.</p></div><ul>{items.map(course => <li key={course.code}><div><strong>{course.code} · {course.title}</strong><RetakeNote course={course} /></div><button className="secondary-button" disabled={disabled} onClick={() => onSelect(course)}>View course</button></li>)}</ul></section>;
}
