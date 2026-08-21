'use client';

import { useMemo, useState } from 'react';
import { ApiError } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { reclassifyLegacyMember } from '../legacy-member-reclassification-api';
import { toLegacyMemberReclassificationRequest } from '../legacy-member-reclassification';
import type { ProfileMemberKind } from '../profile-requirements';
import {
  createInitialProfileForm,
  validateProfileForm,
} from '../profile-state';
import type { ProfileFormValues } from '../types';
import { ProfileOnboardingForm } from './profile-onboarding-form';

const EMPTY_PROFILE = {
  name: '',
  studentId: null,
  department: null,
  isComplete: false,
} as const;

function parseMemberKind(value: string): ProfileMemberKind | null {
  if (value === 'STUDENT') return 'STUDENT';
  if (value === 'STAFF') return 'STAFF';
  return null;
}

export function LegacyMemberReclassificationScreen({
  onComplete,
}: {
  readonly onComplete: () => void;
}) {
  const [memberKind, setMemberKind] = useState<ProfileMemberKind | null>(null);
  const [values, setValues] = useState<ProfileFormValues>(() =>
    createInitialProfileForm(EMPTY_PROFILE),
  );
  const [showRequiredErrors, setShowRequiredErrors] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const errors = useMemo(
    () => validateProfileForm(values, memberKind),
    [memberKind, values],
  );

  function chooseMemberKind(next: ProfileMemberKind | null): void {
    setMemberKind(next);
    setShowRequiredErrors(false);
    setSubmitError(null);
    setValues((current) => ({
      ...current,
      studentId: '',
      affiliationKind: 'DEPARTMENT',
      affiliationName: '',
      departmentOption: '',
      otherDepartment: '',
    }));
  }

  async function submit(): Promise<void> {
    if (memberKind === null) return;
    setShowRequiredErrors(true);
    const request = toLegacyMemberReclassificationRequest(values, memberKind);
    if (request === null) return;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await reclassifyLegacyMember(request);
      onComplete();
    } catch (error: unknown) {
      setSubmitError(
        error instanceof ApiError
          ? error.problem.detail
          : '회원 유형을 저장하지 못했습니다. 다시 시도해 주세요.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main
      data-slot="legacy-member-reclassification"
      data-surface="inverted"
      className="min-h-dvh bg-cosmos-void px-4 py-10 sm:px-6"
    >
      <Card className="mx-auto w-full max-w-2xl break-keep bg-cosmos-near text-cosmos-copy ring-cosmos-border [overflow-wrap:anywhere]">
        <CardHeader>
          <CardTitle role="heading" aria-level={1} className="text-xl">
            회원 유형을 확인해 주세요
          </CardTitle>
          <p className="text-sm leading-normal text-cosmos-muted">
            기존 관리자 권한은 유지됩니다. 학생 또는 교직원 회원 정보를 한 번만
            확인하면 계속 이용할 수 있습니다.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-8">
          <Field>
            <FieldLabel htmlFor="legacy-member-kind">회원 유형</FieldLabel>
            <Select
              id="legacy-member-kind"
              value={memberKind ?? ''}
              onChange={(event) =>
                chooseMemberKind(parseMemberKind(event.target.value))
              }
            >
              <option value="">회원 유형을 선택해 주세요</option>
              <option value="STUDENT">학생</option>
              <option value="STAFF">교직원</option>
            </Select>
            <FieldDescription>
              회원 유형은 관리자 권한과 독립적으로 저장됩니다.
            </FieldDescription>
          </Field>

          {memberKind === null ? null : (
            <ProfileOnboardingForm
              mode="reclassification"
              memberKind={memberKind}
              values={values}
              errors={errors}
              showRequiredErrors={showRequiredErrors}
              isSubmitting={isSubmitting}
              submitError={submitError}
              onChange={(patch) =>
                setValues((current) => ({ ...current, ...patch }))
              }
              onSubmit={() => void submit()}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
