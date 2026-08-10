import { RolesErrorCode } from '../roles/roles-error-code.enum';
import { auditLogHarness } from './admin-access.service.spec-support';
import { mutateAdminUserProfile } from './admin-profile-mutation.service';
import {
  InMemoryAdminProfileRepository,
  profileTarget,
} from './admin-profile.service.spec-support';
import { USERS_ERROR_CODES, UsersErrorCode } from './users-error-code.enum';

const ACTOR_GITHUB_ID = 9_131_500_001n;

describe('mutateAdminUserProfile', () => {
  it('admin이 이미 값이 있는 학번을 다른 값으로 고친다 — 본인 경로의 불변 규칙을 우회한다', async () => {
    // Given
    const repository = new InMemoryAdminProfileRepository();
    repository.target = profileTarget({
      name: '기존 이름',
      studentId: '250001',
      department: '컴퓨터공학과',
    });
    const audit = auditLogHarness();

    // When
    const result = await mutateAdminUserProfile(
      { repository, auditLog: audit.service },
      {
        actorGithubId: ACTOR_GITHUB_ID,
        userId: 'target',
        command: { studentId: '250099' },
      },
    );

    // Then
    expect(result).toEqual({
      id: 'target',
      name: '기존 이름',
      studentId: '250099',
      department: '컴퓨터공학과',
    });
    expect(repository.profileFieldsApplied).toEqual([
      {
        name: '기존 이름',
        studentId: '250099',
        department: '컴퓨터공학과',
      },
    ]);
    // 커맨드에 studentId만 실렸으니 update 페이로드에도 studentId만 실려야 한다 —
    // name·department는 관련 없는 필드라 UPDATE 문에 아예 오르지 않아야 동시에 그
    // 필드를 고친 다른 관리자의 값을 되돌리지 않는다(lost-update, #787 리뷰).
    expect(repository.profileChangedFieldsApplied).toEqual([
      { studentId: '250099' },
    ]);
    expect(audit.record).toHaveBeenCalledTimes(1);
    const [input] = audit.record.mock.calls[0] as [unknown];
    expect(input).toMatchObject({
      actorGithubId: ACTOR_GITHUB_ID,
      action: 'USER_PROFILE_UPDATED',
      targetType: 'USER',
      targetId: 'target',
      metadata: {
        actor: { displayName: '합성 관리자', githubLogin: 'synthetic-admin' },
        target: { displayName: '기존 이름', githubLogin: 'synthetic-target' },
        changes: [{ field: 'studentId', before: '250001', after: '250099' }],
      },
    });
  });

  it('이미 다른 사용자가 쓰는 학번이면 STUDENT_ID_TAKEN_BY_ADMIN으로 거부하고 감사 로그를 남기지 않는다', async () => {
    // Given
    const repository = new InMemoryAdminProfileRepository();
    repository.target = profileTarget({
      name: '기존 이름',
      studentId: '250001',
      department: '컴퓨터공학과',
    });
    repository.applyOutcome = 'studentIdTaken';
    const audit = auditLogHarness();

    // When / Then
    await expect(
      mutateAdminUserProfile(
        { repository, auditLog: audit.service },
        {
          actorGithubId: ACTOR_GITHUB_ID,
            userId: 'target',
          command: { studentId: '259999' },
        },
      ),
    ).rejects.toMatchObject({
      errorCode: USERS_ERROR_CODES[UsersErrorCode.STUDENT_ID_TAKEN_BY_ADMIN],
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('학과 없이 학번만 보내면 STUDENT_ID_NEEDS_DEPARTMENT로 거부한다', async () => {
    // Given — UserProfile 행이 없던 사용자(학번·학과 모두 비어 있음)
    const repository = new InMemoryAdminProfileRepository();
    repository.target = profileTarget({
      name: '기존 이름',
      studentId: null,
      department: null,
    });
    const audit = auditLogHarness();

    // When / Then
    await expect(
      mutateAdminUserProfile(
        { repository, auditLog: audit.service },
        {
          actorGithubId: ACTOR_GITHUB_ID,
            userId: 'target',
          command: { studentId: '260001' },
        },
      ),
    ).rejects.toMatchObject({
      errorCode: USERS_ERROR_CODES[UsersErrorCode.STUDENT_ID_NEEDS_DEPARTMENT],
    });
    expect(repository.profileFieldsApplied).toHaveLength(0);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('형식이 틀린 학번은 저장 전에 400으로 거부한다', async () => {
    // Given
    const repository = new InMemoryAdminProfileRepository();
    repository.target = profileTarget({ name: '기존 이름' });
    const audit = auditLogHarness();

    // When / Then
    await expect(
      mutateAdminUserProfile(
        { repository, auditLog: audit.service },
        {
          actorGithubId: ACTOR_GITHUB_ID,
            userId: 'target',
          command: { studentId: 'not-a-student-id' },
        },
      ),
    ).rejects.toMatchObject({
      errorCode: { code: 'SYS_003', status: 400 },
    });
    expect(repository.profileFieldsApplied).toHaveLength(0);
  });

  it('UserProfile 행이 없던 사용자에게 처음으로 학번·학과를 채우면 새로 만드는 경로(applyProfile)를 탄다', async () => {
    // Given — 구버전 User 컬럼에도, UserProfile 행에도 학번이 없던 사용자
    const repository = new InMemoryAdminProfileRepository();
    repository.target = profileTarget({
      name: '아직 프로필 없는 사용자',
      studentId: null,
      department: null,
    });
    const audit = auditLogHarness();

    // When
    const result = await mutateAdminUserProfile(
      { repository, auditLog: audit.service },
      {
        actorGithubId: ACTOR_GITHUB_ID,
        userId: 'target',
        command: { studentId: '260002', department: '전자공학과' },
      },
    );

    // Then
    expect(result.studentId).toBe('260002');
    expect(repository.profileFieldsApplied).toEqual([
      {
        name: '아직 프로필 없는 사용자',
        studentId: '260002',
        department: '전자공학과',
      },
    ]);
    expect(repository.legacyFieldsApplied).toHaveLength(0);
  });

  it('학번을 건드리지 않는 수정은 구버전 컬럼만 갱신하고 UserProfile 쓰기를 타지 않는다', async () => {
    // Given
    const repository = new InMemoryAdminProfileRepository();
    repository.target = profileTarget({
      name: '기존 이름',
      studentId: null,
      department: null,
    });
    const audit = auditLogHarness();

    // When
    const result = await mutateAdminUserProfile(
      { repository, auditLog: audit.service },
      {
        actorGithubId: ACTOR_GITHUB_ID,
        userId: 'target',
        command: { name: '새 이름' },
      },
    );

    // Then
    expect(result).toEqual({
      id: 'target',
      name: '새 이름',
      studentId: null,
      department: null,
    });
    expect(repository.profileFieldsApplied).toHaveLength(0);
    expect(repository.legacyFieldsApplied).toEqual([{ name: '새 이름' }]);
  });

  it('요청 값이 기존 값과 같아 실제로 바뀐 것이 없으면 감사 로그를 쓰지 않는다', async () => {
    // Given
    const repository = new InMemoryAdminProfileRepository();
    repository.target = profileTarget({
      name: '기존 이름',
      studentId: '250001',
      department: '컴퓨터공학과',
    });
    const audit = auditLogHarness();

    // When
    await mutateAdminUserProfile(
      { repository, auditLog: audit.service },
      {
        actorGithubId: ACTOR_GITHUB_ID,
        userId: 'target',
        command: { name: '기존 이름' },
      },
    );

    // Then
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('학번이 이미 있는 대상(nextStudentId !== null 분기)에서 이름만 고치면 update 페이로드에 studentId·department 키가 없다', async () => {
    // Given — 관리자 A와 B가 같은 대상을 나눠 고치는 상황을 가정한다. 이 테스트는
    // A(이름만) 몫이다 — B(학과만)는 아래 테스트가 담당한다.
    const repository = new InMemoryAdminProfileRepository();
    repository.target = profileTarget({
      name: '기존 이름',
      studentId: '250001',
      department: '컴퓨터공학과',
    });
    const audit = auditLogHarness();

    // When
    await mutateAdminUserProfile(
      { repository, auditLog: audit.service },
      {
        actorGithubId: ACTOR_GITHUB_ID,
        userId: 'target',
        command: { name: '새 이름' },
      },
    );

    // Then
    expect(repository.profileChangedFieldsApplied).toEqual([
      { name: '새 이름' },
    ]);
    const [changedFields] = repository.profileChangedFieldsApplied;
    expect(changedFields).not.toHaveProperty('studentId');
    expect(changedFields).not.toHaveProperty('department');
  });

  it('학번이 이미 있는 대상에서 학과만 고치면 update 페이로드에 name·studentId 키가 없다', async () => {
    // Given — 위 테스트의 짝: 관리자 B가 학과만 고치는 몫.
    const repository = new InMemoryAdminProfileRepository();
    repository.target = profileTarget({
      name: '기존 이름',
      studentId: '250001',
      department: '컴퓨터공학과',
    });
    const audit = auditLogHarness();

    // When
    await mutateAdminUserProfile(
      { repository, auditLog: audit.service },
      {
        actorGithubId: ACTOR_GITHUB_ID,
        userId: 'target',
        command: { department: '전자공학과' },
      },
    );

    // Then
    expect(repository.profileChangedFieldsApplied).toEqual([
      { department: '전자공학과' },
    ]);
    const [changedFields] = repository.profileChangedFieldsApplied;
    expect(changedFields).not.toHaveProperty('name');
    expect(changedFields).not.toHaveProperty('studentId');
  });

  it('대상 사용자가 없으면 USER_NOT_FOUND를 던진다', async () => {
    // Given
    const repository = new InMemoryAdminProfileRepository();
    repository.target = null;
    const audit = auditLogHarness();

    // When / Then
    await expect(
      mutateAdminUserProfile(
        { repository, auditLog: audit.service },
        {
          actorGithubId: ACTOR_GITHUB_ID,
            userId: 'missing',
          command: { name: '이름' },
        },
      ),
    ).rejects.toMatchObject({
      errorCode: { code: RolesErrorCode.USER_NOT_FOUND },
    });
  });
});
