'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { AlertCircle } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { DEPARTMENT_GROUPS, OTHER_DEPARTMENT } from '@/lib/departments';
import { cn } from '@/lib/utils';

import { patchAdminUserProfile } from '../admin-access-api';
import type { AdminAccessProfile } from '../admin-access-api';
import {
  ADMIN_PROFILE_DEPARTMENT_MAX_LENGTH,
  ADMIN_PROFILE_NAME_MAX_LENGTH,
  adminProfileUpdateErrorMessage,
  createAdminProfileEditValues,
  toAdminProfileUpdateCommand,
  validateAdminProfileEdit,
  type AdminProfileEditValues,
} from '../admin-profile-edit-policy';

/**
 * 프로필(이름·학번·학과) 보기/수정 — PR04G의 접근 변경(CAS, 확인 다이얼로그)과
 * 달리 낙관적 잠금이 없는 단순 PATCH라 다이얼로그 없이 이 섹션 안에서 바로
 * 편집·저장한다. 저장에 성공하면 `onSaved`가 부모의 `retry()`를 불러 상세 전체를
 * 다시 가져온다 — `isComplete`는 역할별 필수 항목 판정이 필요한데(features/profile
 * 소관, feature 간 의존 금지) 그 값을 여기서 다시 계산하지 않고 서버가 다시 계산한
 * 값을 그대로 받기 위해서다.
 */
export function AdminAccessProfileSection({
  userId,
  profile,
  headingTag: HeadingTag,
  isOverlay,
  onSaved,
}: {
  readonly userId: string;
  readonly profile: AdminAccessProfile;
  readonly headingTag: 'h2' | 'h3';
  readonly isOverlay: boolean;
  readonly onSaved: () => void;
}) {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [values, setValues] = useState<AdminProfileEditValues>(() =>
    createAdminProfileEditValues(profile),
  );
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function startEdit() {
    setValues(createAdminProfileEditValues(profile));
    setShowValidationErrors(false);
    setSubmitError(null);
    setMode('edit');
  }

  function cancelEdit() {
    setMode('view');
    setShowValidationErrors(false);
    setSubmitError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowValidationErrors(true);
    setSubmitError(null);
    const command = toAdminProfileUpdateCommand(values, profile);
    if (!command) return;
    // 바뀐 항목이 없으면 API를 부르지 않고 바로 보기 모드로 돌아간다.
    if (Object.keys(command).length === 0) {
      setMode('view');
      return;
    }
    setIsSubmitting(true);
    try {
      await patchAdminUserProfile(userId, command);
      setMode('view');
      onSaved();
    } catch (error) {
      setSubmitError(adminProfileUpdateErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  const errors = validateAdminProfileEdit(values, profile);
  const showNameError = showValidationErrors && errors.name !== null;
  const showStudentIdError = showValidationErrors && errors.studentId !== null;
  const showDepartmentError =
    showValidationErrors && errors.department !== null;

  if (mode === 'view') {
    return (
      <>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <HeadingTag
            id="admin-access-profile"
            className="font-heading text-lg font-semibold"
          >
            프로필
          </HeadingTag>
          <Button type="button" variant="outline" size="sm" onClick={startEdit}>
            수정
          </Button>
        </div>
        {!profile.isComplete ? (
          <p className="text-sm text-destructive">
            프로필 미완성 — 교직원 승인·부여 불가
          </p>
        ) : null}
        {/*
          오버레이에서는 2열로 쪼개지 않는다 — `sm:`은 뷰포트 기준이라
          768px·1280px에서도 켜지는데, 실제 렌더 폭은 400px 남짓이라
          한 열이 200px 아래로 눌린다.
        */}
        <dl
          className={cn(
            'grid gap-2 text-sm sm:grid-cols-2',
            isOverlay && 'sm:grid-cols-1',
          )}
        >
          <div>
            <dt className="text-muted-foreground">이름</dt>
            <dd>{profile.name ?? '미등록'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">학번</dt>
            <dd>{profile.studentId ?? '미등록'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">학과</dt>
            <dd>{profile.department ?? '미등록'}</dd>
          </div>
        </dl>
      </>
    );
  }

  return (
    <>
      <HeadingTag
        id="admin-access-profile"
        className="font-heading text-lg font-semibold"
      >
        프로필 수정
      </HeadingTag>
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
      >
        <Field data-invalid={showNameError || undefined}>
          <FieldLabel htmlFor="admin-profile-name">이름</FieldLabel>
          <Input
            id="admin-profile-name"
            name="name"
            autoComplete="name"
            maxLength={ADMIN_PROFILE_NAME_MAX_LENGTH}
            value={values.name}
            aria-invalid={showNameError}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                name: event.target.value,
              }))
            }
          />
          {showNameError ? <FieldError>{errors.name}</FieldError> : null}
        </Field>

        <Field data-invalid={showStudentIdError || undefined}>
          <FieldLabel htmlFor="admin-profile-student-id">학번</FieldLabel>
          <Input
            id="admin-profile-student-id"
            name="studentId"
            inputMode="numeric"
            value={values.studentId}
            aria-invalid={showStudentIdError}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                studentId: event.target.value,
              }))
            }
          />
          {showStudentIdError ? (
            <FieldError>{errors.studentId}</FieldError>
          ) : (
            <FieldDescription>
              숫자 6자리. 관리자는 이미 저장된 학번도 고칠 수 있습니다.
            </FieldDescription>
          )}
        </Field>

        <Field data-invalid={showDepartmentError || undefined}>
          <FieldLabel htmlFor="admin-profile-department">학과</FieldLabel>
          <Select
            id="admin-profile-department"
            name="department"
            value={values.departmentOption}
            aria-invalid={showDepartmentError}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                departmentOption: event.target.value,
                otherDepartment:
                  event.target.value === OTHER_DEPARTMENT
                    ? current.otherDepartment
                    : '',
              }))
            }
          >
            <option value="">학과를 선택해 주세요</option>
            {DEPARTMENT_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.departments.map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
              </optgroup>
            ))}
            <option value={OTHER_DEPARTMENT}>기타(직접 입력)</option>
          </Select>
          {values.departmentOption === OTHER_DEPARTMENT ? (
            <Input
              aria-label="기타 학과"
              placeholder="학과 또는 전공을 입력해 주세요"
              maxLength={ADMIN_PROFILE_DEPARTMENT_MAX_LENGTH}
              value={values.otherDepartment}
              aria-invalid={showDepartmentError}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  otherDepartment: event.target.value,
                }))
              }
            />
          ) : null}
          {showDepartmentError ? (
            <FieldError>{errors.department}</FieldError>
          ) : null}
        </Field>

        {submitError ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertTitle>프로필을 저장하지 못했습니다</AlertTitle>
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={isSubmitting}>
            {isSubmitting ? '저장 중…' : '저장'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isSubmitting}
            onClick={cancelEdit}
          >
            취소
          </Button>
        </div>
      </form>
    </>
  );
}
