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

interface ProfileDepartmentFieldsProps {
  readonly memberKind: ProfileMemberKind;
  readonly values: ProfileFormValues;
  readonly showError: boolean;
  readonly error: string | null;
  readonly departmentRef: RefObject<HTMLSelectElement | null>;
  readonly programOfficeNameRef: RefObject<HTMLInputElement | null>;
  readonly onChange: (patch: Partial<ProfileFormValues>) => void;
}

export function ProfileDepartmentFields({
  memberKind,
  values,
  showError,
  error,
  departmentRef,
  programOfficeNameRef,
  onChange,
}: ProfileDepartmentFieldsProps) {
  const isDepartment = values.departmentType === 'DEPARTMENT';
  return (
    <>
      {memberKind === 'STAFF' ? (
        <Field>
          <FieldLabel htmlFor="profile-department-type">
            소속 유형
            <RequiredMark />
          </FieldLabel>
          <Select
            id="profile-department-type"
            name="departmentType"

            className={cn(
              '[&_optgroup]:bg-popover [&_optgroup]:text-popover-foreground',
              '[&_option]:bg-popover [&_option]:text-popover-foreground',
            )}
            value={values.departmentType}
            onChange={(event) =>
              onChange({
                departmentType:
                  event.target.value === 'PROGRAM_OFFICE'
                    ? 'PROGRAM_OFFICE'
                    : 'DEPARTMENT',
                programOfficeName: '',
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
            isDepartment ? 'profile-department' : 'profile-program-office-name'
          }
        >
          {isDepartment ? '학과' : '사업단'}
          <RequiredMark />
        </FieldLabel>
        {isDepartment ? (
          <>
            <Select
              id="profile-department"
              name="department"
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
            id="profile-program-office-name"
            name="programOfficeName"
            ref={programOfficeNameRef}
            placeholder="소속 사업단을 입력해 주세요"
            maxLength={PROFILE_DEPARTMENT_MAX_LENGTH}
            value={values.programOfficeName}
            aria-invalid={showError}
            aria-describedby={showError ? AFFILIATION_ERROR_ID : undefined}
            onChange={(event) =>
              onChange({ programOfficeName: event.target.value })
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
