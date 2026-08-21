import {
  COMPATIBLE_PROFILE_DEPARTMENT_SELECT,
  resolveCompatibleProfile,
  resolveCompatibleProfileDepartment,
} from './profile-compatibility';

it('keeps a canonical null student ID instead of falling back to the legacy mirror', () => {
  // Given
  const source = {
    name: '레거시 이름',
    studentId: '123456',
    department: '레거시 학부',
    profile: {
      name: '프로필 이름',
      studentId: null,
      department: '프로필 학부',
    },
  };

  // When
  const profile = resolveCompatibleProfile(source);

  // Then
  expect(profile.studentId).toBeNull();
});

it('prefers the UserProfile department over the legacy User column', () => {
  // Given
  const source = {
    department: '레거시 학부',
    profile: { department: '인공지능학부' },
  };

  // When
  const department = resolveCompatibleProfileDepartment(source);

  // Then
  expect(department).toBe('인공지능학부');
});

it('falls back to the legacy User department when no profile row exists', () => {
  // Given
  const source = { department: '소프트웨어학부', profile: null };

  // When
  const department = resolveCompatibleProfileDepartment(source);

  // Then
  expect(department).toBe('소프트웨어학부');
});

it('reports null when neither side carries a department', () => {
  // Given
  const source = { department: null, profile: null };

  // When
  const department = resolveCompatibleProfileDepartment(source);

  // Then
  expect(department).toBeNull();
});

it('selects the department on both sides without reading the real name', () => {
  // Given
  const select = COMPATIBLE_PROFILE_DEPARTMENT_SELECT;

  // When
  const selectedKeys = Object.keys(select);
  const selectedProfileKeys = Object.keys(select.profile.select);

  // Then
  expect(selectedKeys).toStrictEqual(['department', 'profile']);
  expect(selectedProfileKeys).toStrictEqual(['department']);
  expect(JSON.stringify(select)).not.toContain('name');
});
