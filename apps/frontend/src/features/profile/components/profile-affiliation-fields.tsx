import type { RefObject } from 'react';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { DEPARTMENT_GROUPS } from '../departments';
import type { ProfileMemberKind } from '../profile-requirements';
import { PROFILE_DEPARTMENT_MAX_LENGTH } from '../profile-state';
import type { ProfileFormValues } from '../types';

const AFFILIATION_ERROR_ID = 'profile-department-error';

interface ProfileAffiliationFieldsProps {
  readonly memberKind: ProfileMemberKind;
  readonly values: ProfileFormValues;
  readonly showError: boolean;
  readonly error: string | null;
  readonly departmentRef: RefObject<HTMLSelectElement | null>;
  readonly affiliationNameRef: RefObject<HTMLInputElement | null>;
  readonly onChange: (patch: Partial<ProfileFormValues>) => void;
}

export function ProfileAffiliationFields({
  memberKind,
  values,
  showError,
  error,
  departmentRef,
  affiliationNameRef,
  onChange,
}: ProfileAffiliationFieldsProps) {
  const isDepartment = values.affiliationKind === 'DEPARTMENT';
  return (
    <>
      {memberKind === 'STAFF' ? (
        <Field>
          <FieldLabel htmlFor="profile-affiliation-kind">
            소속 유형
            <RequiredMark />
          </FieldLabel>
          <Select
            id="profile-affiliation-kind"
            name="affiliationKind"
            // 열린 목록은 브라우저가 시스템 바탕(흰색) 위에 그린다. 가입 무대가 물려준
            // 흰 글자를 그대로 두면 윈도우 Chrome·Edge 에서 흰 바탕에 흰 글자가 된다
            // (#1435, 아래 학과 칸의 QA34 와 같은 원인).
            className={cn(
              '[&_optgroup]:bg-popover [&_optgroup]:text-popover-foreground',
              '[&_option]:bg-popover [&_option]:text-popover-foreground',
            )}
            value={values.affiliationKind}
            onChange={(event) =>
              onChange({
                affiliationKind:
                  event.target.value === 'PROGRAM_OFFICE'
                    ? 'PROGRAM_OFFICE'
                    : 'DEPARTMENT',
                affiliationName: '',
                departmentOption: '',
                otherDepartment: '',
              })
            }
          >
            <option value="DEPARTMENT">학과</option>
            <option value="PROGRAM_OFFICE">사업단</option>
          </Select>
        </Field>
      ) : null}

      <Field data-invalid={showError || undefined}>
        <FieldLabel
          htmlFor={
            isDepartment ? 'profile-department' : 'profile-affiliation-name'
          }
        >
          {isDepartment ? '학과' : '사업단'}
          <RequiredMark />
        </FieldLabel>
        {isDepartment ? (
          <>
            <Select
              id="profile-department"
              name="affiliationName"
              ref={departmentRef}
              aria-required="true"
              className={cn(
                'aria-invalid:border-destructive aria-invalid:ring-3',
                'aria-invalid:ring-destructive/20',
                'dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
                '[&_optgroup]:bg-popover [&_optgroup]:text-popover-foreground',
                '[&_option]:bg-popover [&_option]:text-popover-foreground',
              )}
              value={values.departmentOption}
              aria-invalid={showError}
              aria-describedby={showError ? AFFILIATION_ERROR_ID : undefined}
              onChange={(event) =>
                onChange({
                  departmentOption: event.target.value,
                  otherDepartment: '',
                })
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
            </Select>
          </>
        ) : (
          <Input
            id="profile-affiliation-name"
            name="affiliationName"
            ref={affiliationNameRef}
            placeholder="소속 사업단을 입력해 주세요"
            maxLength={PROFILE_DEPARTMENT_MAX_LENGTH}
            value={values.affiliationName}
            aria-invalid={showError}
            aria-describedby={showError ? AFFILIATION_ERROR_ID : undefined}
            onChange={(event) =>
              onChange({ affiliationName: event.target.value })
            }
          />
        )}
        {showError ? (
          <FieldError id={AFFILIATION_ERROR_ID}>{error}</FieldError>
        ) : null}
      </Field>
    </>
  );
}

function RequiredMark() {
  return (
    <span className="ml-1 text-small font-semibold text-cosmos-repository">
      필수
    </span>
  );
}
