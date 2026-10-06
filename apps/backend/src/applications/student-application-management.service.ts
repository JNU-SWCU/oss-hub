import { Injectable } from '@nestjs/common';
import type { ApplicationStatus } from '@prisma/client';
import { DomainException } from '../common/error-code';
import {
  checkApplicationTemplateVersion,
  applicationAnswerTooLongMessage,
  normalizeAndValidateApplicationAnswers,
  type ApplicationAnswers,
} from '../programs/application-answers.validator';
import { isProgramApplicationManager } from '../programs/program-participant';
import {
  APPLICATIONS_ERROR_CODES,
  ApplicationsErrorCode,
} from './applications-error-code.enum';
import {
  ApplicationsRepository,
  type ApplyProgramRecord,
} from './applications.repository';
import type { UpdateStudentApplicationInput } from './domain/update-student-application';
import {
  CANCELLABLE_STATUSES,
  RESUBMITTABLE_STATUSES,
  StudentApplicationManagementRepository,
  type OwnedStudentApplication,
  type StudentApplicationMutationFailure,
} from './student-application-management.repository';

export interface StudentApplicationView {
  readonly id: string;
  readonly programId: string;
  readonly status: ApplicationStatus;
  readonly teamId: string | null;
  readonly answers: ApplicationAnswers;
  readonly submittedAt: Date;
  readonly updatedAt: Date;
  readonly isRepositoryPublicationPlanned: boolean;

  readonly rejectionReason: string | null;

  readonly isManager: boolean;
  readonly canManage: boolean;
}

interface StudentApplicationContext {
  readonly studentId: string;
  readonly application: OwnedStudentApplication;
  readonly policy: ApplyProgramRecord;
  readonly isManager: boolean;
}

@Injectable()
export class StudentApplicationManagementService {
  constructor(
    private readonly repository: StudentApplicationManagementRepository,
    private readonly applicationsRepository: ApplicationsRepository,
  ) {}

  async getMine(
    githubId: bigint,
    programId: string,
    now: Date = new Date(),
  ): Promise<StudentApplicationView | null> {
    const context = await this.findContext(githubId, programId);
    if (!context) return null;
    const editable = this.isEditable(context.application, context.policy, now);
    return this.toView(context.application, context.isManager, editable);
  }

  async updateMine(
    githubId: bigint,
    programId: string,
    input: UpdateStudentApplicationInput,
    now: Date = new Date(),
  ): Promise<StudentApplicationView> {
    const context = await this.requireContext(githubId, programId);
    this.requireManager(context);
    this.requireMutable(
      context.application,
      context.policy,
      now,
      RESUBMITTABLE_STATUSES,
    );
    const versionCheck = checkApplicationTemplateVersion(
      input.applicationTemplateVersion,
      context.policy.applicationTemplateVersion,
    );
    if (!versionCheck.ok) {
      throw this.error(ApplicationsErrorCode.TEMPLATE_VERSION_MISMATCH);
    }
    const answers = normalizeAndValidateApplicationAnswers(
      input.answers,
      this.resolveApplicantName(context.application),
      'enforce-length',
    );
    if (!answers.ok) {
      if (answers.reason === 'TOO_LONG')
        throw new DomainException(
          APPLICATIONS_ERROR_CODES[ApplicationsErrorCode.ANSWER_TOO_LONG],
          {
            fieldErrors: (answers.tooLongKeys ?? []).map((key) => ({
              field: key,
              code: ApplicationsErrorCode.ANSWER_TOO_LONG,
              message: applicationAnswerTooLongMessage(key),
            })),
          },
        );
      throw this.error(ApplicationsErrorCode.INVALID_ANSWERS);
    }
    const result = await this.repository.updatePendingApplication({
      programId,
      studentId: context.studentId,
      answers: answers.answers,
      applicationTemplateVersion: input.applicationTemplateVersion,
    });
    if (result.kind !== 'updated') this.throwMutationFailure(result);
    return this.toView(result.application, true, true);
  }

  async cancelMine(
    githubId: bigint,
    programId: string,
    now: Date = new Date(),
  ): Promise<{ readonly cancelled: true }> {
    const context = await this.requireContext(githubId, programId);
    this.requireManager(context);
    this.requireMutable(
      context.application,
      context.policy,
      now,
      CANCELLABLE_STATUSES,
    );
    const result = await this.repository.deletePendingApplication({
      programId,
      studentId: context.studentId,
    });
    if (result.kind !== 'cancelled') this.throwMutationFailure(result);
    return { cancelled: true };
  }

  private async requireContext(
    githubId: bigint,
    programId: string,
  ): Promise<StudentApplicationContext> {
    const context = await this.findContext(githubId, programId);
    if (!context) {
      throw this.error(ApplicationsErrorCode.APPLICATION_NOT_FOUND);
    }
    return context;
  }

  private async findContext(
    githubId: bigint,
    programId: string,
  ): Promise<StudentApplicationContext | null> {
    const student =
      await this.applicationsRepository.findActiveStudentByGithubId(githubId);
    if (!student) throw this.error(ApplicationsErrorCode.STUDENT_ONLY);
    const [application, policy] = await Promise.all([
      this.repository.findOwnedApplication(programId, student.id),
      this.applicationsRepository.findProgramById(programId),
    ]);
    if (!policy) throw this.error(ApplicationsErrorCode.PROGRAM_NOT_FOUND);
    if (!application) return null;
    return {
      studentId: student.id,
      application,
      policy,

      isManager: isProgramApplicationManager(student.id, {
        teamLeaderId: application.teamLeaderId,
      }),
    };
  }

  private requireManager(context: StudentApplicationContext): void {
    if (!context.isManager) {
      throw this.error(ApplicationsErrorCode.APPLICATION_NOT_FOUND);
    }
  }

  private throwMutationFailure(
    failure: StudentApplicationMutationFailure,
  ): never {
    const code = {
      'program-not-found': ApplicationsErrorCode.PROGRAM_NOT_FOUND,
      'application-not-found': ApplicationsErrorCode.APPLICATION_NOT_FOUND,
      'already-decided': ApplicationsErrorCode.APPLICATION_ALREADY_DECIDED,
      'period-closed': ApplicationsErrorCode.APPLICATION_PERIOD_CLOSED,
      'template-version-mismatch':
        ApplicationsErrorCode.TEMPLATE_VERSION_MISMATCH,
    }[failure.kind];
    throw this.error(code);
  }

  private requireMutable(
    application: OwnedStudentApplication,
    policy: ApplyProgramRecord,
    now: Date,
    allowedStatuses: readonly ApplicationStatus[],
  ): void {
    if (!allowedStatuses.includes(application.status)) {
      throw this.error(ApplicationsErrorCode.APPLICATION_ALREADY_DECIDED);
    }
    if (!this.isPeriodOpen(policy, now)) {
      throw this.error(ApplicationsErrorCode.APPLICATION_PERIOD_CLOSED);
    }
  }

  private isEditable(
    application: OwnedStudentApplication,
    policy: ApplyProgramRecord,
    now: Date,
  ): boolean {
    return (
      RESUBMITTABLE_STATUSES.includes(application.status) &&
      this.isPeriodOpen(policy, now)
    );
  }

  private isPeriodOpen(policy: ApplyProgramRecord, now: Date): boolean {
    return policy.applicationStartAt <= now && now <= policy.applicationEndAt;
  }

  private toView(
    application: OwnedStudentApplication,
    isManager: boolean,
    editable: boolean,
  ): StudentApplicationView {
    const answers = normalizeAndValidateApplicationAnswers(
      application.answers,
      this.resolveApplicantName(application),
      'skip-length',
    );
    if (!answers.ok) {
      throw this.error(ApplicationsErrorCode.INVALID_ANSWERS);
    }
    return {
      id: application.id,
      programId: application.programId,
      status: application.status,
      teamId: application.teamId,
      answers: answers.answers,
      submittedAt: application.submittedAt,
      updatedAt: application.updatedAt,
      isRepositoryPublicationPlanned:
        application.isRepositoryPublicationPlanned,
      rejectionReason: application.rejectionReason,
      isManager,
      canManage: isManager && editable,
    };
  }

  private resolveApplicantName(application: OwnedStudentApplication): string {
    return (
      application.applicant.name ?? application.applicant.nickname
    ).trim();
  }

  private error(code: ApplicationsErrorCode): DomainException {
    return new DomainException(APPLICATIONS_ERROR_CODES[code]);
  }
}
