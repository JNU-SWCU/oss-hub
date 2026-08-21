import type { RefObject } from 'react';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { DEPARTMENT_GROUPS, OTHER_DEPARTMENT } from '../departments';
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
  readonly otherDepartmentRef: RefObject<HTMLInputElement | null>;
  readonly affiliationNameRef: RefObject<HTMLInputElement | null>;
  readonly onChange: (patch: Partial<ProfileFormValues>) => void;
}

export function ProfileAffiliationFields({
  memberKind,
  values,
  showError,
  error,
  departmentRef,
  otherDepartmentRef,
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
              className="aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_optgroup]:bg-popover [&_optgroup]:text-popover-foreground [&_option]:bg-popover [&_option]:text-popover-foreground"
              value={values.departmentOption}
              aria-invalid={showError}
              aria-describedby={showError ? AFFILIATION_ERROR_ID : undefined}
              onChange={(event) =>
                onChange({
                  departmentOption: event.target.value,
                  otherDepartment:
                    event.target.value === OTHER_DEPARTMENT
                      ? values.otherDepartment
                      : '',
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
              <option value={OTHER_DEPARTMENT}>기타(직접 입력)</option>
            </Select>
            {values.departmentOption === OTHER_DEPARTMENT ? (
              <Input
                aria-label="기타 학과"
                ref={otherDepartmentRef}
                placeholder="학과 또는 전공을 입력해 주세요"
                maxLength={PROFILE_DEPARTMENT_MAX_LENGTH}
                value={values.otherDepartment}
                aria-invalid={showError}
                aria-describedby={showError ? AFFILIATION_ERROR_ID : undefined}
                onChange={(event) =>
                  onChange({ otherDepartment: event.target.value })
                }
              />
            ) : null}
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
