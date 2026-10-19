import curriculum from './curriculum.json';

export const curriculumInfo = {
  program: 'Bachelor of Science in Information Technology',
  revision: 'Revised 2023',
  effectiveYear: '2023–2024',
  source: 'BSIT-2023-2024-PROGRESS-RECORD (1).docx',
};
export const yearLabels = { 1: 'First year', 2: 'Second year', 3: 'Third year', 4: 'Fourth year' };
export const termLabels = { 1: '1st semester', 2: '2nd semester', summer: 'Summer' };
export const courses = curriculum.map(course => ({
  ...course,
  category: `${yearLabels[course.year]} · ${termLabels[course.semester]}`,
  instructor: 'Unassigned', grade: null, status: 'Not taken',
}));
