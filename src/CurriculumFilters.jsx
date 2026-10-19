import { termLabels, yearLabels } from './data.js';

export default function CurriculumFilters({ year, semester, onYearChange, onSemesterChange }) {
  return <div className="curriculum-filters">
    <label><span>Year level</span><select aria-label="Curriculum year level" value={year} onChange={event => { const next = event.target.value; onYearChange(next); if (next !== '1' && semester === 'summer') onSemesterChange('1'); }}>{Object.entries(yearLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label><span>Term</span><select aria-label="Curriculum semester" value={semester} onChange={event => onSemesterChange(event.target.value)}>{Object.entries(termLabels).filter(([value]) => value !== 'summer' || year === '1').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
  </div>;
}
