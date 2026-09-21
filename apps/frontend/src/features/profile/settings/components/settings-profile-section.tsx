import { FormSection } from '@/components';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { DEPARTMENT_GROUPS, OTHER_DEPARTMENT } from '../../departments';
import type { ProfileMemberKind } from '../../profile-requirements';
import {
  hasSavedStudentId,
  PROFILE_DEPARTMENT_MAX_LENGTH,
  PROFILE_NAME_MAX_LENGTH,
} from '../../profile-state';
import type { SettingsFormErrors, SettingsFormValues } from '../types';

interface SettingsProfileSectionProps {
  readonly memberKind: ProfileMemberKind | null;
  readonly values: SettingsFormValues;
  readonly errors: SettingsFormErrors;
  readonly showValidationErrors: boolean;
  readonly onChange: (patch: Partial<SettingsFormValues>) => void;
}

export function SettingsProfileSection({
  memberKind,
  values,
  errors,
  showValidationErrors,
  onChange,
}: SettingsProfileSectionProps) {
  const showNameError = showValidationErrors && errors.name !== null;
  const showStudentIdError = showValidationErrors && errors.studentId !== null;
  const showPhoneError = showValidationErrors && errors.phone !== null;
  const showDepartmentError =
    showValidationErrors && errors.department !== null;
  const isStudentIdLocked = hasSavedStudentId(values);
  /*
   * 오류가 떠도 형식 안내는 남긴다. 「숫자 6자리」가 필요한 순간이 바로
   * 틀렸을 때인데, 예전에는 그때 안내가 DOM 에서 사라졌다.
   * 낭독기에는 안내 id 뒤에 오류 id 를 덧붙여 둘 다 읽히게 한다
   * (program-requirement-editor 가 쓰는 형태와 같다).
   */
  const describedBy = (helpId: string, errorId: string, hasError: boolean) =>
    hasError ? `${helpId} ${errorId}` : helpId;
  const showStudentId = memberKind === 'STUDENT' || isStudentIdLocked;

  return (
    <FormSection title="프로필">
      <Field data-invalid={showNameError || undefined}>
        <FieldLabel htmlFor="settings-name">이름</FieldLabel>
        <Input
          id="settings-name"
          name="name"
          autoComplete="name"
          maxLength={PROFILE_NAME_MAX_LENGTH}
          value={values.name}
          aria-invalid={showNameError}
          aria-describedby={showNameError ? 'settings-name-error' : undefined}
          onChange={(event) => onChange({ name: event.target.value })}
        />
        {showNameError ? (
          <FieldError id="settings-name-error">{errors.name}</FieldError>
        ) : null}
      </Field>

      {showStudentId ? (
        <Field data-invalid={showStudentIdError || undefined}>
          <FieldLabel htmlFor="settings-student-id">학번</FieldLabel>
          <Input
            id="settings-student-id"
            name="studentId"
            inputMode="numeric"
            maxLength={6}
            value={values.studentId}
            readOnly={isStudentIdLocked}
            disabled={isStudentIdLocked}
            aria-readonly={isStudentIdLocked || undefined}
            aria-invalid={showStudentIdError}
            aria-describedby={describedBy(
              'settings-student-id-description',
              'settings-student-id-error',
              showStudentIdError,
            )}
            onChange={
              isStudentIdLocked
                ? undefined
                : (event) =>
                    onChange({
                      studentId: event.target.value.replace(/\D/g, ''),
                    })
            }
          />
          <FieldDescription id="settings-student-id-description">
            {isStudentIdLocked
              ? '학번은 변경할 수 없습니다.'
              : '숫자 6자리 · 사용자가 입력한 식별 정보'}
          </FieldDescription>
          {showStudentIdError ? (
            <FieldError id="settings-student-id-error">
              {errors.studentId}
            </FieldError>
          ) : null}
        </Field>
      ) : null}

      <Field data-invalid={showPhoneError || undefined}>
        <FieldLabel htmlFor="settings-phone">전화번호</FieldLabel>
        <Input
          id="settings-phone"
          name="phone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          maxLength={11}
          value={values.phone}
          aria-invalid={showPhoneError}
          aria-describedby={describedBy(
            'settings-phone-description',
            'settings-phone-error',
            showPhoneError,
          )}
          onChange={(event) => onChange({ phone: event.target.value })}
        />
        <FieldDescription id="settings-phone-description">
          프로그램 운영진이 선정·팀 운영 안내를 연락할 때 사용합니다.
        </FieldDescription>
        {showPhoneError ? (
          <FieldError id="settings-phone-error">{errors.phone}</FieldError>
        ) : null}
      </Field>

      <Field data-invalid={showDepartmentError || undefined}>
        <FieldLabel htmlFor="settings-department">소속</FieldLabel>
        <Select
          id="settings-department"
          name="department"
          value={values.departmentOption}
          aria-invalid={showDepartmentError}
          aria-describedby={
            showDepartmentError ? 'settings-department-error' : undefined
          }
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
          <option value="">소속을 선택해 주세요</option>
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
            aria-label="기타 소속"
            placeholder="학과 또는 소속을 입력해 주세요"
            maxLength={PROFILE_DEPARTMENT_MAX_LENGTH}
            value={values.otherDepartment}
            aria-invalid={showDepartmentError}
            aria-describedby={
              showDepartmentError ? 'settings-department-error' : undefined
            }
            onChange={(event) =>
              onChange({ otherDepartment: event.target.value })
            }
          />
        ) : null}
        {showDepartmentError ? (
          <FieldError id="settings-department-error">
            {errors.department}
          </FieldError>
        ) : null}
      </Field>
    </FormSection>
  );
}
