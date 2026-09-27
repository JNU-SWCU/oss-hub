'use client';

import { useEffect, useRef, useState } from 'react';

import { DialogShell } from '@/components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import type { AdminAccessMutationAction } from '../admin-access-mutation-policy';
import {
  ADMIN_PROFILE_DEPARTMENT_MAX_LENGTH,
  isValidAdminProfileDepartment,
} from '../admin-profile-edit-policy';
import type {
  CanonicalAdminAccessProfile,
  MemberKindMutationFields,
} from '../independent-authority-api';

interface AdminAccessMutationConfirmDialogProps {
  readonly action: AdminAccessMutationAction;
  readonly title: string;
  readonly description?: string | null;
  readonly confirmLabel: string;
  readonly destructive: boolean;
  readonly isProcessing: boolean;
  readonly errorMessage: string | null;
  readonly profile?: CanonicalAdminAccessProfile;
  readonly onCancel: () => void;
  readonly onConfirm: (fields?: MemberKindMutationFields) => void;
}

const STUDENT_ID_PATTERN = /^\d{6}$/;
const STAFF_NUMBER_MAX_LENGTH = 100;

type MemberKindDialogTarget = 'STUDENT' | 'STAFF' | null;

function memberKindDialogTarget(
  action: AdminAccessMutationAction,
): MemberKindDialogTarget {
  if (action === 'SET_MEMBER_STUDENT') return 'STUDENT';
  if (action === 'SET_MEMBER_STAFF') return 'STAFF';
  return null;
}

/**
 * Shared confirmation dialog for access/status writes. Member-kind actions add
 * only the fields owned by that action; all other actions retain the existing
 * confirmation-only surface.
 */
export function AdminAccessMutationConfirmDialog({
  action,
  title,
  description,
  confirmLabel,
  destructive,
  isProcessing,
  errorMessage,
  profile,
  onCancel,
  onConfirm,
}: AdminAccessMutationConfirmDialogProps) {
  const target = memberKindDialogTarget(action);
  const [studentId, setStudentId] = useState(profile?.studentId ?? '');
  const [department, setDepartment] = useState(profile?.department ?? '');
  const [staffNumber, setStaffNumber] = useState(profile?.staffNumber ?? '');
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const [invalidSubmitCount, setInvalidSubmitCount] = useState(0);
  const formRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(getCurrentFocusTarget());

  useEffect(() => {
    if (invalidSubmitCount === 0) return;
    formRef.current
      ?.querySelector<HTMLElement>('[aria-invalid="true"]')
      ?.focus();
  }, [invalidSubmitCount]);

  useEffect(() => {
    setStudentId(profile?.studentId ?? '');
    setDepartment(profile?.department ?? '');
    setStaffNumber(profile?.staffNumber ?? '');
    setShowValidationErrors(false);
  }, [action, profile?.department, profile?.staffNumber, profile?.studentId]);

  const existingStudentId = profile?.studentId ?? '';
  const hasExistingStudentId = existingStudentId.trim().length > 0;
  const storedDepartment = (profile?.department ?? '').trim().normalize('NFC');
  const hasStoredDepartment = storedDepartment.length > 0;
  const normalizedStudentId = studentId.trim();
  const studentIdError =
    target !== 'STUDENT' || hasExistingStudentId
      ? null
      : normalizedStudentId.length === 0
        ? '학번을 입력해 주세요.'
        : STUDENT_ID_PATTERN.test(normalizedStudentId)
          ? null
          : '새 학번은 숫자 6자리로 입력해 주세요.';
  const normalizedDepartment = department.trim().normalize('NFC');
  const departmentError =
    target === 'STUDENT' &&
    !hasStoredDepartment &&
    !isValidAdminProfileDepartment(normalizedDepartment)
      ? `학과를 1~${ADMIN_PROFILE_DEPARTMENT_MAX_LENGTH}자로 입력해 주세요.`
      : null;
  const normalizedStaffNumber = staffNumber.trim().normalize('NFC');
  const hasStoredStaffNumber =
    (profile?.staffNumber ?? '').trim().normalize('NFC').length > 0;
  const staffNumberError =
    target === 'STAFF' &&
    [...normalizedStaffNumber].length > STAFF_NUMBER_MAX_LENGTH
      ? `교직원 번호는 ${STAFF_NUMBER_MAX_LENGTH}자 이하로 입력해 주세요.`
      : null;
  const hasValidationError =
    studentIdError !== null ||
    departmentError !== null ||
    staffNumberError !== null;

  function handleConfirm() {
    if (isProcessing) return;
    setShowValidationErrors(true);
    if (hasValidationError) {
      setInvalidSubmitCount((count) => count + 1);
      return;
    }

    if (target === 'STUDENT') {
      const fields: MemberKindMutationFields = {
        department: hasStoredDepartment
          ? storedDepartment
          : normalizedDepartment,
        ...(hasExistingStudentId ? {} : { studentId: normalizedStudentId }),
      };
      onConfirm(fields);
      return;
    }
    if (target === 'STAFF') {
      onConfirm({
        staffNumber:
          normalizedStaffNumber.length === 0 ? null : normalizedStaffNumber,
      });
      return;
    }
    onConfirm();
  }

  function handleCancel() {
    if (isProcessing) return;
    onCancel();
  }

  return (
    <DialogShell
      title={title}
      description={description}
      busy={isProcessing}
      returnFocusRef={returnFocusRef}
      onCancel={handleCancel}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            disabled={isProcessing}
            onClick={handleCancel}
          >
            취소
          </Button>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            disabled={isProcessing}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div ref={formRef} className="grid gap-5">
        {target === 'STUDENT' ? (
          <div className="grid gap-4">
            {hasExistingStudentId ? (
              <Field>
                <FieldLabel>학번</FieldLabel>
                <p className="rounded-md border border-border px-3 py-2 text-sm">
                  {existingStudentId}
                </p>
                <FieldDescription>저장된 학번을 사용합니다.</FieldDescription>
              </Field>
            ) : (
              <Field
                data-invalid={showValidationErrors && studentIdError !== null}
              >
                <FieldLabel htmlFor="admin-member-kind-student-id">
                  학번
                </FieldLabel>
                <Input
                  id="admin-member-kind-student-id"
                  value={studentId}
                  inputMode="numeric"
                  required
                  aria-invalid={showValidationErrors && studentIdError !== null}
                  aria-describedby={
                    showValidationErrors && studentIdError
                      ? 'admin-member-student-id-description admin-member-student-id-error'
                      : 'admin-member-student-id-description'
                  }
                  disabled={isProcessing}
                  onChange={(event) => setStudentId(event.target.value)}
                />
                <FieldDescription id="admin-member-student-id-description">
                  새 학번은 숫자 6자리로 입력해 주세요.
                </FieldDescription>
                {showValidationErrors && studentIdError ? (
                  <FieldError id="admin-member-student-id-error">
                    {studentIdError}
                  </FieldError>
                ) : null}
              </Field>
            )}
            {hasStoredDepartment ? (
              <Field>
                <FieldLabel>학과</FieldLabel>
                <p className="rounded-md border border-border px-3 py-2 text-sm">
                  {storedDepartment}
                </p>
                <FieldDescription>저장된 학과를 사용합니다.</FieldDescription>
              </Field>
            ) : (
              <Field
                data-invalid={showValidationErrors && departmentError !== null}
              >
                <FieldLabel htmlFor="admin-member-kind-department">
                  학과
                </FieldLabel>
                <Input
                  id="admin-member-kind-department"
                  value={department}
                  required
                  maxLength={ADMIN_PROFILE_DEPARTMENT_MAX_LENGTH}
                  aria-invalid={
                    showValidationErrors && departmentError !== null
                  }
                  aria-describedby={
                    showValidationErrors && departmentError
                      ? 'admin-member-department-description admin-member-department-error'
                      : 'admin-member-department-description'
                  }
                  disabled={isProcessing}
                  onChange={(event) => setDepartment(event.target.value)}
                />
                <FieldDescription id="admin-member-department-description">
                  학과를 입력해 주세요.
                </FieldDescription>
                {showValidationErrors && departmentError ? (
                  <FieldError id="admin-member-department-error">
                    {departmentError}
                  </FieldError>
                ) : null}
              </Field>
            )}
          </div>
        ) : null}
        {target === 'STAFF' ? (
          <Field
            data-invalid={showValidationErrors && staffNumberError !== null}
          >
            <FieldLabel htmlFor="admin-member-kind-staff-number">
              교직원 번호 (선택)
            </FieldLabel>
            <Input
              id="admin-member-kind-staff-number"
              value={staffNumber}
              maxLength={STAFF_NUMBER_MAX_LENGTH}
              aria-invalid={showValidationErrors && staffNumberError !== null}
              aria-describedby={
                showValidationErrors && staffNumberError
                  ? 'admin-member-staff-number-description admin-member-staff-number-error'
                  : 'admin-member-staff-number-description'
              }
              disabled={isProcessing}
              onChange={(event) => setStaffNumber(event.target.value)}
            />
            <FieldDescription id="admin-member-staff-number-description">
              {hasStoredStaffNumber
                ? '비우면 등록된 번호가 삭제됩니다.'
                : '사번을 입력해 주세요.'}
            </FieldDescription>
            {showValidationErrors && staffNumberError ? (
              <FieldError id="admin-member-staff-number-error">
                {staffNumberError}
              </FieldError>
            ) : null}
          </Field>
        ) : null}
        {errorMessage ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </DialogShell>
  );
}

function getCurrentFocusTarget(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const activeElement = document.activeElement;
  return activeElement instanceof HTMLElement && activeElement !== document.body
    ? activeElement
    : null;
}
