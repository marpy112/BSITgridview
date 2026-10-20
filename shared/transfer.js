export const normalizeSchoolAcronym = value => value.normalize('NFC').trim().replace(/\s+/g, ' ').toUpperCase();

export function validSchoolAcronym(value) {
  return typeof value === 'string' && value.length <= 30 &&
    /^[\p{L}\p{N}][\p{L}\p{N} .&'()/-]*$/u.test(value);
}
