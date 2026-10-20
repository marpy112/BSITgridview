import { normalizeSchoolAcronym, validSchoolAcronym } from '../shared/transfer.js';

export const studentStatuses = ['Active', 'Inactive', 'Graduated'];

export function validateStudent(input, editing = false) {
  if (!input || typeof input !== 'object') return 'Enter valid student details.';
  if (!Number.isInteger(input.year) || input.year < 1 || input.year > 4) return 'Year level must be between first and fourth year.';
  if (!studentStatuses.includes(input.studentStatus)) return 'Choose Active, Inactive, or Graduated for student status.';
  if (typeof input.email !== 'string' || input.email.length > 160 || (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))) return 'Enter a valid student email or leave it blank.';
  if (input.isTransferee !== undefined && typeof input.isTransferee !== 'boolean') return 'Choose a valid student type.';
  if (input.previousSchool !== undefined && (typeof input.previousSchool !== 'string' || (input.previousSchool !== '' && !validSchoolAcronym(normalizeSchoolAcronym(input.previousSchool))))) return 'Enter a school acronym of up to 30 letters, numbers, spaces, or school-name punctuation.';
  if (input.isTransferee && (typeof input.previousSchool !== 'string' || !validSchoolAcronym(normalizeSchoolAcronym(input.previousSchool)))) return 'Enter the transferee’s previous school acronym.';
  if (editing) return '';
  if (typeof input.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{2,31}$/.test(input.id.trim())) return 'Student ID must contain 3–32 letters, numbers, or hyphens.';
  for (const [field, label] of [['firstName','First name'],['lastName','Last name']]) {
    if (typeof input[field] !== 'string' || !input[field].trim() || input[field].length > 80) return `${label} is required and must be at most 80 characters.`;
  }
  if (typeof input.middleName !== 'string' || input.middleName.length > 80) return 'Middle name must be at most 80 characters.';
  if (new TextEncoder().encode(input.lastName.trim().normalize('NFC')).length > 72) return 'Last name is too long for the initial password (maximum 72 UTF-8 bytes).';
  return '';
}
