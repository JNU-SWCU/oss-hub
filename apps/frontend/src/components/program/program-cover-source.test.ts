import { expect, it } from 'vitest';
import { apiPath } from '@/lib/api-client';
import { programCoverSource } from './program-cover-source';

it('keeps external HTTPS covers out of the API prefix while preserving owned paths', () => {
  expect(programCoverSource('/programs/example/cover/cover-one')).toBe(
    apiPath('/programs/example/cover/cover-one'),
  );
  expect(
    programCoverSource('https://sojoong.kr/wp-content/uploads/poster.jpg'),
  ).toBe('https://sojoong.kr/wp-content/uploads/poster.jpg');
  expect(programCoverSource(null)).toBeNull();
  expect(programCoverSource('javascript:alert(1)')).toBeNull();
  expect(programCoverSource('http://localhost/private')).toBeNull();
  expect(programCoverSource('//attacker.invalid/poster.jpg')).toBeNull();
});
