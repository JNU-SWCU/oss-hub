import { ApplicationStatus } from '@prisma/client';
export const STUDENT_APPLICATION_MANAGEMENT_CLOCK = Symbol(
  'STUDENT_APPLICATION_MANAGEMENT_CLOCK',
);

export const RESUBMITTABLE_STATUSES: readonly ApplicationStatus[] = [
  ApplicationStatus.SUBMITTED,
  ApplicationStatus.REJECTED,
];

export const CANCELLABLE_STATUSES: readonly ApplicationStatus[] = [
  ApplicationStatus.SUBMITTED,
];
