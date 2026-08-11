import { Injectable } from '@nestjs/common';
import { ApplicationStatus } from '@prisma/client';
import { DomainException } from '../common/error-code';
import {
  checkApplicationTemplateVersion,
  applicationAnswerTooLongMessage,
  normalizeAndValidateApplicationAnswers,
  type ApplicationAnswers,
} from '../programs/application-answers.validator';
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
  /**
   * 반려 사유. 상태와 무관하게 **항상 키가 있고**, 반려가 아니면 `null`이다.
   * 반려일 때만 키를 실으면 클라이언트에서 "없는 키"와 "null"이 다르게 읽혀,
   * 사유가 아직 안 온 것인지 애초에 없는 것인지 구분할 수 없다.
   */
  readonly rejectionReason: string | null;
  readonly canManage: boolean;
}

interface StudentApplicationContext {
  readonly studentId: string;
  readonly application: OwnedStudentApplication;
  readonly policy: ApplyProgramRecord;
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
  ): Promise<StudentApplicationView> {
    const context = await this.requireContext(githubId, programId);
    const editable = this.isEditable(context.application, context.policy, now);
    return this.toView(context.application, editable);
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
    const answers = normalizeAndValidateApplicationAnswers(
      input.answers,
      this.resolveApplicantName(context.application),
      'enforce-length',
    );
    if (!answers.ok) {
      // 넘친 칸을 그대로 실어 보낸다 — 하나의 뭉뚱그린 문구만 주면 학생이 무엇을 줄일지 모른다.
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
    return this.toView(result.application, true);
  }

  async cancelMine(
    githubId: bigint,
    programId: string,
    now: Date = new Date(),
  ): Promise<{ readonly cancelled: true }> {
    const context = await this.requireContext(githubId, programId);
    this.requireEditable(context.application, context.policy, now);
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
    const student =
      await this.applicationsRepository.findActiveStudentByGithubId(githubId);
    if (!student) throw this.error(ApplicationsErrorCode.STUDENT_ONLY);
    const [application, policy] = await Promise.all([
      this.repository.findOwnedApplication(programId, student.id),
      this.applicationsRepository.findProgramById(programId),
    ]);
    if (!policy) throw this.error(ApplicationsErrorCode.PROGRAM_NOT_FOUND);
    if (!application) {
      throw this.error(ApplicationsErrorCode.APPLICATION_NOT_FOUND);
    }
    return { studentId: student.id, application, policy };
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

  private requireEditable(
    application: OwnedStudentApplication,
    policy: ApplyProgramRecord,
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
    policy: ApplyProgramRecord,
    now: Date,
  ): boolean {
    return (
      application.status === ApplicationStatus.SUBMITTED &&
      this.isPeriodOpen(policy, now)
    );
  }

  private isPeriodOpen(policy: ApplyProgramRecord, now: Date): boolean {
    return policy.applicationStartAt <= now && now <= policy.applicationEndAt;
  }

  private toView(
    application: OwnedStudentApplication,
    editable: boolean,
  ): StudentApplicationView {
    // ⚠ 읽기라 길이를 재지 않는다 — 재면 상한이 생기기 전에 저장된 긴 신청서를
    //   학생이 **열지도 못한다**(고치라고 만든 상한이 고칠 길을 막는다).
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
      canManage: editable,
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
