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
  const showDepartmentError =
    showValidationErrors && errors.department !== null;
  const isStudentIdLocked = hasSavedStudentId(values);
  const showStudentId = memberKind === 'STUDENT' || isStudentIdLocked;
  const editableFields = '이름과 학과를 수정할 수 있습니다.';
  const description = isStudentIdLocked
    ? `${editableFields} 학번은 변경할 수 없습니다.`
    : editableFields;

  return (
    <FormSection title="프로필" description={description}>
      <Field data-invalid={showNameError || undefined}>
        <FieldLabel htmlFor="settings-name">이름</FieldLabel>
        <Input
          id="settings-name"
          name="name"
          autoComplete="name"
          maxLength={PROFILE_NAME_MAX_LENGTH}
          value={values.name}
          aria-invalid={showNameError}
          onChange={(event) => onChange({ name: event.target.value })}
        />
        {showNameError ? <FieldError>{errors.name}</FieldError> : null}
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
            onChange={
              isStudentIdLocked
                ? undefined
                : (event) =>
                    onChange({
                      studentId: event.target.value.replace(/\D/g, ''),
                    })
            }
          />
          {showStudentIdError ? (
            <FieldError>{errors.studentId}</FieldError>
          ) : (
            <FieldDescription>
              {isStudentIdLocked
                ? '학번은 변경할 수 없습니다.'
                : '숫자 6자리 · 사용자가 입력한 식별 정보'}
            </FieldDescription>
          )}
        </Field>
      ) : null}

      <Field data-invalid={showDepartmentError || undefined}>
        <FieldLabel htmlFor="settings-department">소속</FieldLabel>
        <Select
          id="settings-department"
          name="department"
          value={values.departmentOption}
          aria-invalid={showDepartmentError}
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
            onChange={(event) =>
              onChange({ otherDepartment: event.target.value })
            }
          />
        ) : null}
        {showDepartmentError ? (
          <FieldError>{errors.department}</FieldError>
        ) : null}
      </Field>
    </FormSection>
  );
}
