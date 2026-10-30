import { ApplicationStatus } from '@prisma/client';

export function isProgramApplicationManager(
  userId: string,
  application: { readonly teamLeaderId: string },
): boolean {
  return application.teamLeaderId === userId;
}

export function canEditStudentRepositoryUrl(
  context: {
    readonly status: ApplicationStatus;
    readonly endAt: Date;
    readonly isManager: boolean;
  },
  now: Date,
): boolean {
  return (
    context.isManager &&
    context.status === ApplicationStatus.APPROVED &&
    now < context.endAt
  );
}
