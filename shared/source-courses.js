import curriculum from '../src/curriculum.json' with { type: 'json' };

const normalize = value => String(value).normalize('NFC').toLowerCase().replaceAll('&',' and ').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
const titles = new Map(curriculum.map(c=>[normalize(c.title), c.code]));
const aliases = {
  'readings in phillipine history':'GE CORE 2',
  'reading in the philippine history':'GE CORE 2',
  'the contemporary word':'GE CORE 3',
  'mathematics in modern world':'GE CORE 4',
  'computer program 01':'IT 02',
  'introduction to computer interaction':'IT 05',
  'data structure and algorithm':'IT 07',
  'civic welfare trainingprogram 1':'NSTP 1',
  'civic welfare training and service 1':'NSTP 1',
  'civic welfare training and service 2':'NSTP 2',
  'civic welfare traning service 2':'NSTP 2',
  'pathfit 3 fundamentals of martial arts':'PE 3',
  'fundamentals of martial arts':'PE 3',
  'life and works of rizal':'RIZAL',
  'fundamentals of database systems':'IT 16',
  'systems integration and architecture 1':'IT 17',
  'information assurance and security 1':'IT 19',
  'multimedia systems':'IT 25',
  'school guidance program 6':'SGP 6',
  'ojt practicum':'OJT',
  'practice 486 hours':'OJT',
};
for (const [title,code] of Object.entries(aliases)) titles.set(title,code);
const canonical = new Map(curriculum.map(c=>[c.code,c]));
export const instructorKey = name => name.normalize('NFC').replace(/\s+/g,' ').trim().toLowerCase();

export function mapSourceCourse(course) {
  let code = titles.get(normalize(course.title));
  if (normalize(course.title)==='school guidance program') {
    const number=/^SGP\s*0?([1-6])$/i.exec(course.subjectCode)?.[1];
    code=number ? `SGP ${number}` : undefined;
  }
  if (!code || Number(course.units)!==canonical.get(code).units) return null;
  return code;
}
