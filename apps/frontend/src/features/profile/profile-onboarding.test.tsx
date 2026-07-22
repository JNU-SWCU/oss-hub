import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEPARTMENT_GROUPS, OTHER_DEPARTMENT } from './departments';
import {
  ProfileForm,
  ProfileSkeleton,
} from './components/profile-onboarding-screen';
import { validateProfileForm } from './profile-state';
import type { ProfileFormValues } from './types';

const noOp = () => undefined;

function values(overrides: Partial<ProfileFormValues> = {}): ProfileFormValues {
  return {
    name: 'GitHub 합성 이름',
    studentId: '1'.repeat(6),
    departmentOption: '인공지능학부',
    otherDepartment: '',
    ...overrides,
  };
}

function renderForm(
  formValues: ProfileFormValues,
  options: {
    readonly showRequiredErrors?: boolean;
    readonly isSubmitting?: boolean;
    readonly submitError?: string | null;
  } = {},
) {
  return renderToStaticMarkup(
    <ProfileForm
      values={formValues}
      errors={validateProfileForm(formValues)}
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

    expect(html).toContain('학번은 숫자 6~10자리로 입력해 주세요.');
    expect(html).toContain('학과를 선택하거나 입력해 주세요.');
    expect(html).toContain('disabled=""');
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
