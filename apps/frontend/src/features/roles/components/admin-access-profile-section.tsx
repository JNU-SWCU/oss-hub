'use client';

import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
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
import type { CanonicalAdminAccessDetail } from '../independent-authority-api';
import {
  ADMIN_PROFILE_DEPARTMENT_MAX_LENGTH,
  ADMIN_PROFILE_NAME_MAX_LENGTH,
  adminProfileUpdateErrorMessage,
  createAdminProfileEditValues,
  toAdminProfileUpdateCommand,
  validateAdminProfileEdit,
  type AdminProfileEditValues,
} from '../admin-profile-edit-policy';

export function AdminAccessProfileSection({
  userId,
  profile,
  headingTag: HeadingTag,
  isOverlay,
  allowEdit,
  onSaved,
}: {
  readonly userId: string;
  readonly profile: CanonicalAdminAccessDetail['profile'];
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

  const [invalidSubmitCount, setInvalidSubmitCount] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (invalidSubmitCount === 0) return;
    const firstInvalidField =
      formRef.current?.querySelector<HTMLElement>(
        '[aria-invalid="true"]:not(:disabled)',
      ) ?? null;
    firstInvalidField?.focus({ preventScroll: true });
    firstInvalidField?.scrollIntoView?.({ block: 'center' });
  }, [invalidSubmitCount]);

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
    if (!command) {
      setInvalidSubmitCount((count) => count + 1);
      return;
    }

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
          {!profile.isComplete ? (
            <p className="text-muted-foreground text-sm">
              프로필 미완성 — 교직원 승인·부여 불가
            </p>
          ) : null}

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
              <dt className="text-muted-foreground">교직원 번호</dt>
              <dd>{profile.staffNumber ?? '미등록'}</dd>
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
          ref={formRef}
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
