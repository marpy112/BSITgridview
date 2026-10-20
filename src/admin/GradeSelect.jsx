const grades = ['5.0', '3.0', '2.75', '2.50', '2.25', '2.0', '1.75', '1.50', '1.25', '1.0'];

export default function GradeSelect({ value, onChange, ...props }) {
  const selected = value === '' ? '' : Number(value).toFixed(2);
  const existingGrade = selected !== '' && !grades.some(grade => Number(grade) === Number(selected));
  return <select {...props} value={selected} onChange={onChange}>
    <option value="">No grade</option>
    {existingGrade && <option value={selected} disabled>{selected} (saved)</option>}
    {grades.map(grade => <option key={grade} value={Number(grade).toFixed(2)}>{grade}</option>)}
  </select>;
}
