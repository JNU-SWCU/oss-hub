import {
  isCompleteUserProfile,
  USER_NAME_MAX_LENGTH,
} from './user-profile-policy';

it('astral Unicode characters count as one profile character', () => {
  // Given
  const name = '😀'.repeat(51);

  // When
  const complete = isCompleteUserProfile({
    id: 'synthetic-astral-name',
    name,
    studentId: '153401',
    department: '인공지능학부',
  });

  // Then
  expect(name.length).toBeGreaterThan(USER_NAME_MAX_LENGTH);
  expect(complete).toBe(true);
});

it('rejects a profile that exceeds the code-point limit', () => {
  // Given
  const name = '😀'.repeat(USER_NAME_MAX_LENGTH + 1);

  // When
  const complete = isCompleteUserProfile({
    id: 'synthetic-astral-name-too-long',
    name,
    studentId: '153402',
    department: '인공지능학부',
  });

  // Then
  expect(complete).toBe(false);
});
