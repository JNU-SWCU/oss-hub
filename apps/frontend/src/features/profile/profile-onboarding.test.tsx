import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEPARTMENT_GROUPS, OTHER_DEPARTMENT } from './departments';
import {
  ProfileForm,
  ProfileSkeleton,
} from './components/profile-onboarding-screen';
import {
  PROFILE_DEPARTMENT_MAX_LENGTH,
  PROFILE_NAME_MAX_LENGTH,
  validateProfileForm,
} from './profile-state';
import type { ProfileRole } from './profile-requirements';
import type { ProfileFormValues } from './types';

const noOp = () => undefined;

function values(overrides: Partial<ProfileFormValues> = {}): ProfileFormValues {
  return {
    name: 'GitHub 합성 이름',
    studentId: '1'.repeat(6),
    savedStudentId: '',
    departmentOption: '인공지능학부',
    otherDepartment: '',
    ...overrides,
  };
}

function renderForm(
  formValues: ProfileFormValues,
  options: {
    readonly role?: ProfileRole | null;
    readonly showRequiredErrors?: boolean;
    readonly isSubmitting?: boolean;
    readonly submitError?: string | null;
  } = {},
) {
  const role = options.role ?? null;
  return renderToStaticMarkup(
    <ProfileForm
      role={role}
      values={formValues}
      errors={validateProfileForm(formValues, role)}
      showRequiredErrors={options.showRequiredErrors ?? false}
      isSubmitting={options.isSubmitting ?? false}
      submitError={options.submitError ?? null}
      onChange={noOp}
      onSubmit={noOp}
    />,
  );
}

describe('profile onboarding view', () => {
  it('조회 중 프로필 Skeleton을 표시한다', () => {
    const html = renderToStaticMarkup(<ProfileSkeleton />);
    expect(html).toContain('aria-label="프로필을 불러오는 중"');
    expect(html).toContain('animate-pulse');
  });

  it('초기 폼에 15개 학과·트랙과 기타 직접 입력을 모두 표시한다', () => {
    const html = renderForm(values());
    const departments = DEPARTMENT_GROUPS.flatMap((group) => group.departments);

    expect(departments).toHaveLength(15);
    for (const department of departments) {
      expect(html).toContain(department);
    }
    expect(html).toContain('기타(직접 입력)');
    expect(html).toContain('GitHub 합성 이름');
  });

  it('잘못된 학번과 기타 학과 미입력을 인라인 오류로 표시한다', () => {
    const html = renderForm(
      values({
        studentId: 'A'.repeat(6),
        departmentOption: OTHER_DEPARTMENT,
        otherDepartment: '',
      }),
      { showRequiredErrors: true },
    );

    expect(html).toContain('학번은 숫자 6자리로 입력해 주세요.');
    expect(html).toContain('학과를 선택하거나 입력해 주세요.');
  });

  it('이름과 직접 입력 학과의 길이를 100자로 제한한다', () => {
    const overLimit = PROFILE_NAME_MAX_LENGTH + 1;
    const html = renderForm(
      values({
        name: '가'.repeat(overLimit),
        departmentOption: OTHER_DEPARTMENT,
        otherDepartment: '나'.repeat(PROFILE_DEPARTMENT_MAX_LENGTH + 1),
      }),
      { showRequiredErrors: true },
    );

    expect(html).toContain(`maxLength="${PROFILE_NAME_MAX_LENGTH}"`);
    expect(html).toContain(`maxLength="${PROFILE_DEPARTMENT_MAX_LENGTH}"`);
    expect(html).toContain('이름은 100자 이하로 입력해 주세요.');
    expect(html).toContain('학과는 100자 이하로 입력해 주세요.');
  });

  it('학생에게는 이름·학번·학과를 모두 보여 준다', () => {
    const html = renderForm(values(), { role: 'STUDENT' });

    expect(html).toContain('profile-name');
    expect(html).toContain('profile-student-id');
    expect(html).toContain('profile-department');
    expect(html).toContain('항목(이름, 학번, 학과)');
  });

  it('교직원에게는 학번 칸을 아예 보여 주지 않는다', () => {
    // 학번은 학생만 가질 수 있다 — 교직원이 요청에 studentId를 실으면
    // 백엔드가 400으로 거절하므로(users.service.ts), 화면은 애초에 입력받지 않는다.
    const html = renderForm(values({ studentId: '' }), {
      role: 'STAFF',
      showRequiredErrors: true,
    });

    expect(html).not.toContain('profile-student-id');
    expect(html).toContain('profile-department');
    expect(html).toContain('항목(이름, 학과)');
    // 학번 없이도 저장 버튼이 열린다.
    expect(html).not.toMatch(/type="submit"[^>]*disabled/);
  });

  it('관리자에게는 학번·학과 칸을 모두 감춘다', () => {
    const html = renderForm(values({ studentId: '', departmentOption: '' }), {
      role: 'ADMIN',
      showRequiredErrors: true,
    });

    expect(html).not.toContain('profile-student-id');
    expect(html).not.toContain('profile-department');
    expect(html).toContain('profile-name');
    expect(html).toContain('항목(이름)');
    expect(html).not.toMatch(/type="submit"[^>]*disabled/);
  });

  it('학과·학번이 비어 있어도 가입 마치기 버튼은 눌린다', () => {
    // Given / When — 첫 가입자의 상태. 버튼을 꺼 두면 눌러 볼 수 없고, 눌러 보지 못하면
    // 무엇이 비었는지 말해 주는 경로(`showRequiredErrors`)에 영영 닿지 못한다.
    const html = renderForm(values({ studentId: '', departmentOption: '' }), {
      role: 'STUDENT',
    });

    // Then — 아직 누르기 전이라 문구는 없지만, 버튼은 열려 있다.
    expect(html).not.toMatch(/type="submit"[^>]*disabled/);
    expect(html).not.toContain('학과를 선택하거나 입력해 주세요.');
    expect(html).not.toContain('학번은 숫자 6자리로 입력해 주세요.');
  });

  it('빈 채로 제출하면 비어 있는 학번·학과를 문구로 알려 준다', () => {
    // Given / When — 제출이 `showRequiredErrors`를 켠 뒤의 화면.
    const html = renderForm(values({ studentId: '', departmentOption: '' }), {
      role: 'STUDENT',
      showRequiredErrors: true,
    });

    // Then — 어느 칸이 비었는지 칸 표시(aria-invalid)와 문구가 함께 말한다.
    expect(html).toContain('학번은 숫자 6자리로 입력해 주세요.');
    expect(html).toContain('학과를 선택하거나 입력해 주세요.');
    expect(html).toMatch(/id="profile-student-id"[^>]*aria-invalid="true"/);
    expect(html).toMatch(/id="profile-department"[^>]*aria-invalid="true"/);
    // 다시 누를 수 있어야 한다 — 고쳐 쓴 뒤 같은 버튼으로 저장까지 간다.
    expect(html).not.toMatch(/type="submit"[^>]*disabled/);
  });

  it('오류 문구를 입력칸에 aria-describedby로 연결한다', () => {
    const html = renderForm(
      values({ name: '', studentId: '', departmentOption: '' }),
      { role: 'STUDENT', showRequiredErrors: true },
    );

    expect(html).toContain('aria-describedby="profile-name-error"');
    expect(html).toContain('id="profile-name-error"');
    expect(html).toContain(
      'aria-describedby="profile-student-id-description profile-student-id-error"',
    );
    expect(html).toContain('id="profile-student-id-error"');
    expect(html).toContain('aria-describedby="profile-department-error"');
    expect(html).toContain('id="profile-department-error"');
  });

  it('서버가 거절한 뒤 값을 지워도 필수 항목 안내가 남아 있다', () => {
    // Given / When — 학번 중복으로 한 번 거절당한 사용자가 학번·학과를 지우고
    // 다시 쓰는 중. 제출을 한 번 거친 화면이므로 안내는 계속 켜져 있어야 한다.
    const html = renderForm(values({ studentId: '', departmentOption: '' }), {
      role: 'STUDENT',
      showRequiredErrors: true,
      submitError:
        '이미 다른 계정이 사용 중인 학번입니다. 학번을 다시 확인해 주세요.',
    });

    // Then — 서버 실패 Alert와 칸별 안내가 함께 남는다.
    expect(html).toContain('프로필을 저장하지 못했습니다');
    expect(html).toContain('이미 다른 계정이 사용 중인 학번입니다.');
    expect(html).toContain('학번은 숫자 6자리로 입력해 주세요.');
    expect(html).toContain('학과를 선택하거나 입력해 주세요.');
  });

  it('저장 중 중복 클릭을 막고 서버 실패 Alert를 표시한다', () => {
    const savingHtml = renderForm(values(), { isSubmitting: true });
    const failedHtml = renderForm(values(), {
      submitError: '잠시 후 다시 시도해 주세요.',
    });

    expect(savingHtml).toContain('저장 중…');
    expect(savingHtml).toContain('disabled=""');
    expect(failedHtml).toContain('프로필을 저장하지 못했습니다');
    expect(failedHtml).toContain('잠시 후 다시 시도해 주세요.');
  });
});
