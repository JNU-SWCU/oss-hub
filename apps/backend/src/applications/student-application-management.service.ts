import { Injectable } from '@nestjs/common';
import { ApplicationStatus, type Prisma } from '@prisma/client';
import { DomainException } from '../common/error-code';
import {
  checkApplicationTemplateVersion,
  normalizeAndValidateApplicationAnswers,
  type ApplicationAnswers,
} from '../programs/application-answers.validator';
import {
  APPLICATIONS_ERROR_CODES,
  ApplicationsErrorCode,
} from './applications-error-code.enum';
import type { UpdateStudentApplicationInput } from './domain/update-student-application';

export interface StudentApplicationActor {
  readonly id: string;
  readonly name: string | null;
  readonly nickname: string;
}

export interface StudentApplicationPolicy {
  readonly applicationStartAt: Date;
  readonly applicationEndAt: Date;
  readonly applicationTemplateVersion: number;
}

export interface OwnedStudentApplication {
  readonly id: string;
  readonly programId: string;
  readonly status: ApplicationStatus;
  readonly teamId: string | null;
  readonly answers: Prisma.JsonValue;
  readonly submittedAt: Date;
  readonly updatedAt: Date;
}

export interface UpdatePendingApplicationRecord {
  readonly applicationId: string;
  readonly answers: Prisma.InputJsonValue;
  readonly applicationTemplateVersion: number;
}

export interface StudentApplicationStore {
  findActiveStudentByGithubId(
    githubId: bigint,
  ): Promise<StudentApplicationActor | null>;
  findOwnedApplication(
    programId: string,
    studentId: string,
  ): Promise<OwnedStudentApplication | null>;
  findProgramPolicy(
    programId: string,
  ): Promise<StudentApplicationPolicy | null>;
  updatePendingApplication(
    input: UpdatePendingApplicationRecord,
  ): Promise<OwnedStudentApplication | null>;
  deletePendingApplication(applicationId: string): Promise<boolean>;
}

export interface StudentApplicationView {
  readonly id: string;
  readonly programId: string;
  readonly status: ApplicationStatus;
  readonly teamId: string | null;
  readonly answers: ApplicationAnswers;
  readonly submittedAt: Date;
  readonly updatedAt: Date;
  readonly canEdit: boolean;
  readonly canCancel: boolean;
}

interface StudentApplicationContext {
  readonly student: StudentApplicationActor;
  readonly application: OwnedStudentApplication;
  readonly policy: StudentApplicationPolicy;
}

@Injectable()
export class StudentApplicationManagementService {
  constructor(private readonly store: StudentApplicationStore) {}

  async getMine(
    githubId: bigint,
    programId: string,
    now: Date = new Date(),
  ): Promise<StudentApplicationView> {
    const context = await this.requireContext(githubId, programId);
    const editable = this.isEditable(context.application, context.policy, now);
    return this.toView(context.application, context.student, editable);
  }

  async updateMine(
    githubId: bigint,
    programId: string,
    input: UpdateStudentApplicationInput,
    now: Date = new Date(),
  ): Promise<StudentApplicationView> {
    const context = await this.requireContext(githubId, programId);
    this.requireEditable(context.application, context.policy, now);
    const versionCheck = checkApplicationTemplateVersion(
      input.applicationTemplateVersion,
      context.policy.applicationTemplateVersion,
    );
    if (!versionCheck.ok) {
      throw this.error(ApplicationsErrorCode.TEMPLATE_VERSION_MISMATCH);
    }
    const applicantName = (
      context.student.name ?? context.student.nickname
    ).trim();
    const answers = normalizeAndValidateApplicationAnswers(
      input.answers,
      applicantName,
    );
    if (!answers.ok) {
      throw this.error(ApplicationsErrorCode.INVALID_ANSWERS);
    }
    const updated = await this.store.updatePendingApplication({
      applicationId: context.application.id,
      answers: answers.answers,
      applicationTemplateVersion: context.policy.applicationTemplateVersion,
    });
    if (!updated) {
      throw this.error(ApplicationsErrorCode.APPLICATION_ALREADY_DECIDED);
    }
    return this.toView(updated, context.student, true);
  }

  async cancelMine(
    githubId: bigint,
    programId: string,
    now: Date = new Date(),
  ): Promise<{ readonly cancelled: true }> {
    const context = await this.requireContext(githubId, programId);
    this.requireEditable(context.application, context.policy, now);
    const cancelled = await this.store.deletePendingApplication(
      context.application.id,
    );
    if (!cancelled) {
      throw this.error(ApplicationsErrorCode.APPLICATION_ALREADY_DECIDED);
    }
    return { cancelled: true };
  }

  private async requireContext(
    githubId: bigint,
    programId: string,
  ): Promise<StudentApplicationContext> {
    const student = await this.store.findActiveStudentByGithubId(githubId);
    if (!student) throw this.error(ApplicationsErrorCode.STUDENT_ONLY);
    const [application, policy] = await Promise.all([
      this.store.findOwnedApplication(programId, student.id),
      this.store.findProgramPolicy(programId),
    ]);
    if (!policy) throw this.error(ApplicationsErrorCode.PROGRAM_NOT_FOUND);
    if (!application) {
      throw this.error(ApplicationsErrorCode.APPLICATION_NOT_FOUND);
    }
    return { student, application, policy };
  }

  private requireEditable(
    application: OwnedStudentApplication,
    policy: StudentApplicationPolicy,
    now: Date,
  ): void {
    if (application.status !== ApplicationStatus.SUBMITTED) {
      throw this.error(ApplicationsErrorCode.APPLICATION_ALREADY_DECIDED);
    }
    if (!this.isPeriodOpen(policy, now)) {
      throw this.error(ApplicationsErrorCode.APPLICATION_PERIOD_CLOSED);
    }
  }

  private isEditable(
    application: OwnedStudentApplication,
    policy: StudentApplicationPolicy,
    now: Date,
  ): boolean {
    return (
      application.status === ApplicationStatus.SUBMITTED &&
      this.isPeriodOpen(policy, now)
    );
  }

  private isPeriodOpen(policy: StudentApplicationPolicy, now: Date): boolean {
    return policy.applicationStartAt <= now && now <= policy.applicationEndAt;
  }

  private toView(
    application: OwnedStudentApplication,
    student: StudentApplicationActor,
    editable: boolean,
  ): StudentApplicationView {
    const answers = normalizeAndValidateApplicationAnswers(
      application.answers,
      (student.name ?? student.nickname).trim(),
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
      canEdit: editable,
      canCancel: editable,
    };
  }

  private error(code: ApplicationsErrorCode): DomainException {
    return new DomainException(APPLICATIONS_ERROR_CODES[code]);
  }
}
