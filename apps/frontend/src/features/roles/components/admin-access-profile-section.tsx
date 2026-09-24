'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { AlertCircle, Pencil } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
 *
 * 보기·수정 두 모드가 모두 카드 하나로 서서 이 섹션이 한 덩어리로 읽힌다 — 같은 열에
 * 서는 「대기 중인 요청」·「접근 변경」이 이미 카드이고, 이름·학번·학과만 테두리 없이
 * 떠있으면 이 세 덩어리가 같은 층으로 읽히지 않는다. 표제는 카드 안에서도 진짜
 * 제목 요소(`headingTag`)로 남긴다 — 이 화면은 상세·오버레이 두 곳에서 제목 순서가
 * 달라지고(h2/h3), 목차로 훑어다니는 사람이 이 카드를 건너뛰면 안 된다.
 */
export function AdminAccessProfileSection({
  userId,
  profile,
  headingTag: HeadingTag,
  isOverlay,
  allowEdit,
  onSaved,
}: {
  readonly userId: string;
  readonly profile: AdminAccessProfile;
  readonly headingTag: 'h2' | 'h3';
  readonly isOverlay: boolean;
  readonly allowEdit: boolean;
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
      <Card>
        <CardHeader>
          <CardTitle>
            <HeadingTag id="admin-access-profile">프로필</HeadingTag>
          </CardTitle>
          {allowEdit ? (
            <CardAction>
              {/*
                「수정」이라는 글자 대신 연필을 둔다. 카드 몸이 이름·학번·학과 세 값뿐이라
                머릿글에 글자 버튼을 두면 그 버튼이 제목과 같은 무게로 읽힌다. 낭독기·
                검색을 위해 이름은 `sr-only`로 남기고, 무엇을 고치는지까지 적는다 —
                같은 화면에 고칠 수 있는 덩어리가 여럿이라 「수정」만으로는 모자란다.
              */}
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={startEdit}
              >
                <Pencil aria-hidden="true" />
                <span className="sr-only">프로필 수정</span>
              </Button>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-3">
          {/*
            「프로필 미완성」은 검증 실패가 아니라 상시 상태라 오류색을 쓰지 않는다.
            같은 화면의 FieldError 와 같은 빨강이면 「지금 뭔 잘못 입력했다」로 읽힌다.
          */}
          {!profile.isComplete ? (
            <p className="text-muted-foreground text-sm">
              프로필 미완성 — 교직원 승인·부여 불가
            </p>
          ) : null}
          {/*
            오버레이에서는 2열로 쪠개지 않는다 — `sm:`은 뷰포트 기준이라
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
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <HeadingTag id="admin-access-profile">프로필 수정</HeadingTag>
        </CardTitle>
      </CardHeader>
      <CardContent>
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
              aria-describedby={
                showNameError ? 'admin-profile-name-error' : undefined
              }
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
            {showNameError ? (
              <FieldError id="admin-profile-name-error">
                {errors.name}
              </FieldError>
            ) : null}
          </Field>

          <Field data-invalid={showStudentIdError || undefined}>
            <FieldLabel htmlFor="admin-profile-student-id">학번</FieldLabel>
            <Input
              id="admin-profile-student-id"
              name="studentId"
              inputMode="numeric"
              value={values.studentId}
              aria-invalid={showStudentIdError}
              /*
               * 오류가 떠도 형식 안내를 남긴다 — 「숫자 6자리」가 필요한 순간이
               * 바로 틀렸을 때다. 낭독기에는 안내 뒤에 오류를 덧붙여 읽힌다.
               */
              aria-describedby={
                showStudentIdError
                  ? 'admin-profile-student-id-description admin-profile-student-id-error'
                  : 'admin-profile-student-id-description'
              }
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  studentId: event.target.value,
                }))
              }
            />
            <FieldDescription id="admin-profile-student-id-description">
              숫자 6자리. 관리자는 이미 저장된 학번도 고칠 수 있습니다.
            </FieldDescription>
            {showStudentIdError ? (
              <FieldError id="admin-profile-student-id-error">
                {errors.studentId}
              </FieldError>
            ) : null}
          </Field>

          <Field data-invalid={showDepartmentError || undefined}>
            <FieldLabel htmlFor="admin-profile-department">학과</FieldLabel>
            <Select
              id="admin-profile-department"
              name="department"
              value={values.departmentOption}
              aria-invalid={showDepartmentError}
              aria-describedby={
                showDepartmentError
                  ? 'admin-profile-department-error'
                  : undefined
              }
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
                aria-describedby={
                  showDepartmentError
                    ? 'admin-profile-department-error'
                    : undefined
                }
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    otherDepartment: event.target.value,
                  }))
                }
              />
            ) : null}
            {showDepartmentError ? (
              <FieldError id="admin-profile-department-error">
                {errors.department}
              </FieldError>
            ) : null}
          </Field>

          {submitError ? (
            <Alert variant="destructive">
              <AlertCircle aria-hidden="true" />
              <AlertTitle>프로필을 저장하지 못했습니다</AlertTitle>
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2">
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
      </CardContent>
    </Card>
  );
}
