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
  /**
   * 반려 사유. 상태와 무관하게 **항상 키가 있고**, 반려가 아니면 `null`이다.
   * 반려일 때만 키를 실으면 클라이언트에서 "없는 키"와 "null"이 다르게 읽혀,
   * 사유가 아직 안 온 것인지 애초에 없는 것인지 구분할 수 없다.
   */
  readonly rejectionReason: string | null;
  /**
   * 이 신청서를 수정·취소할 수 있는 사람인지 — **지금 그 팀의 팀장**만 그렇다(#1083).
   * 처음 신청한 사람이라는 것은 근거가 아니다 — 그랬면 팀을 떠난 뒤에도 옴겨가 남는다.
   * 기간·상태와 무관한 **권한**만 말한다. 지금 실제로 누를 수 있는지는 `canManage`다.
   * 둘을 갈라 두는 이유는 화면이 「기간이 지났다」와 「당신 권한이 아니다」를
   * 다르게 말해야 하기 때문이다 — 팀원에게 기간 안내를 하면 기다리면 열릴 줄 안다.
   */
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

  /**
   * 조회는 「없음」을 오류로 보지 않는다.
   *
   * 신청하지 않은 학생에게 신청이 없는 것은 정상이다. 404로 답하면 화면은 멀쩡한데
   * 콘솔·서버 로그에 4xx가 쌓이고, 콘솔 오류를 기준 삼는 브라우저 자동 검사가 이
   * 화면들을 검사하지 못한다(QA174). 「없음」만 null이고 나머지는 그대로 던진다 —
   * 학생이 아니면 403(`STUDENT_ONLY`), 프로그램 자체가 없으면 404(`PROGRAM_NOT_FOUND`).
   *
   * 변경(`updateMine`·`cancelMine`)은 여전히 `APPLICATION_NOT_FOUND`를 던진다. 없는
   * 것을 고치라는 요청은 실제로 오류다.
   */
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

  /**
   * 「없음」을 null로 돌려주는 조회용 경로. 학생이 아님·프로그램 없음은 그대로 던진다.
   *
   * `findOwnedApplication`의 null은 두 가지를 합친다 — 신청이 아예 없거나, 신청은
   * 있지만 조회자가 지금 그 팀의 구성원이 아니거나(팀을 떠났거나 제외됐다). 조회자
   * 시점에서는 둘 다 「당신에게 보여줄 신청이 없다」이고, 응답에 새로 실리는 정보도
   * 없다. 갈라야 할 일이 생기면 레포가 두 경우를 구분해 돌려주게 바꾼다.
   */
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
      // `findOwnedApplication`이 이미 「지금 이 팀 사람인가」로 좁혀 놓았으므로 남은 물음은
      // 「그 팀의 팀장인가」만이다. 신청자 id는 넘기지 않는다 — 표시용 기록이다.
      isManager: isProgramApplicationManager(student.id, {
        teamLeaderId: application.teamLeaderId,
      }),
    };
  }

  /**
   * 조회는 팀원 전원에게 열려 있지만 수정·취소는 현재 팀장만 할 수 있다(#1083).
   *
   * 이 판정은 잠금 밖에서 읽은 행을 보므로 그 사이에 승계가 일어나면 낙은 답이 된다 —
   * repository가 `Team` 행을 잡은 뒤 같은 판정을 다시 하므로 그쪽이 최종 관문이고
   * 여기는 앞선 거절이다
   * (`requireEditable`가 `validateMutation`보다 앞서는 것과 같은 짜임) — 될 수 없는
   * 요청 때문에 Program 행을 `FOR UPDATE`로 잠그지 않는다.
   * 오류는 repository가 돌려주는 실패와 같은 `APPLICATION_NOT_FOUND`로 맞춘다.
   */
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

  /**
   * 수정·재제출은 검토대기와 **반려**에서 열리고(R-1), 신청 취소는 검토대기에서만 열린다.
   * 승인된 신청은 어느 쪽도 들어가지 못한다.
   *
   * 호출자가 허용 집합을 넘긴다 — 이 함수가 한 집합을 고르면 수정과 취소 중 한쪽이
   * 조용히 틀린 범위를 본다. 저장소도 같은 상수를 써(`RESUBMITTABLE_STATUSES`/
   * `CANCELLABLE_STATUSES`) 잔금 안밖의 두 판정이 갈라지지 않게 한다.
   */
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
