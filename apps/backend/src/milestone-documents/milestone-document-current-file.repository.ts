import { Inject, Injectable } from '@nestjs/common';
import {
  AccountStatus,
  MilestoneDocumentKind,
  Prisma,
  SubmissionFileLifecycle,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const currentFileSelect = {
  revision: true,
  files: {
    select: {
      storageKey: true,
      originalFileName: true,
      mimeType: true,
      sizeBytes: true,
      submissionHistory: { select: { revision: true } },
    },
  },
} as const;

type CurrentFileRow = Prisma.MilestoneDocumentSubmissionGetPayload<{
  select: typeof currentFileSelect;
}>;

interface CurrentFilePrisma {
  readonly milestoneDocumentSubmission: {
    findFirst(
      args: Prisma.MilestoneDocumentSubmissionFindFirstArgs,
    ): Promise<CurrentFileRow | null>;
  };
}

export interface CurrentMilestoneDocumentFile {
  readonly storageKey: string;
  readonly originalFileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export interface MilestoneDocumentCurrentFileReader {
  findForParticipant(
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
  ): Promise<CurrentMilestoneDocumentFile | null>;
}

@Injectable()
export class MilestoneDocumentCurrentFileRepository implements MilestoneDocumentCurrentFileReader {
  constructor(
    @Inject(PrismaService) private readonly prisma: CurrentFilePrisma,
  ) {}

  /**
   * 같은 서류 줄의 「보기」와 「받기」는 **같은 자격**을 쓴다 — 목록·이력이 보여 준 파일은 받을
   * 수 있고, 목록에 없는 파일은 여기서도 없다(#1204).
   *
   * 그래서 이 where는 목록(`MilestoneDocumentsService.listForViewer`)과 이력
   * (`historyForParticipant`)이 학생의 신청을 찾는 문을 조각째 옮긴 것이다.
   *
   * - **활성 학생 계정** — 목록·이력의 `findActiveUser`(`githubId` + `ACTIVE`)에 대응한다.
   * - **`kind: DOCUMENT`이고 이 마일스톤 소속인 서류** — 목록의 `findByMilestoneId`와 이력의
   *   `findDocumentContext`가 거는 조건이다. 옛 제출 슬롯(`LEGACY_MILESTONE_SUBMISSION`)은
   *   목록에 뜨지 않으므로 여기서도 뜨지 않는다.
   * - **이 마일스톤을 가진 프로그램 신청의 팀 구성원** — 이력의 `findStudentApplication`
   *   (`programId` + `submissionParticipantWhere`)에 대응한다.
   *
   * `submissionParticipantWhere`는 **팀 소속 하나**로 참여자를 판정한다(D5 — 모든 신청이 Team을
   * 갖고 개인 참여는 1인 팀이다). 그래서 여기서도 팀장·팀원만 문이다. `Application.applicantId`는
   * 별도의 문이 **아니다**: 신청을 내는 경로가 신청자를 그 팀의 팀장이나 팀원으로 만들고
   * (`ApplicationsService.submit`), 신청이 붙은 팀에서는 탈퇴가 거절된다
   * (`ProgramTeamsRepository.leave` → `'locked'`). 그래서 지우는 것이 지금 누구의 접근도 빼앗지
   * 않는다. 반대로 어떤 경위로든 신청자가 팀 밖에 놓이면 목록·이력이 이미 그를 막으므로, 받기만
   * 열어 두면 「이력에 없는 파일이 열리는」 자리가 된다.
   *
   * **신청이 지금 승인 상태인지는 묻지 않는다.** 승인 되돌리기는 제출 행도 첨부도 지우지 않는
   * 순수한 상태 전이라(#1096) 목록은 `hasCurrentFile: true`를 사실대로 말한다. 여기서만 승인을
   * 물으면 되돌려진 학생은 목록이 「있다」고 한 파일을 눌러 MSD_020 404를 받는다.
   * 쓰기(제출·업로드)의 승인 요구는 그대로다 — 그쪽이 `APPLICATION_APPROVAL_REQUIRED`
   * (「승인된 신청만 제출할 수 있습니다」)의 제자리다.
   *
   * 목록과 **의도적으로 다른 곳이 한 군데** 있다: 여기는 `hasStaffAccess`·`hasAdminAccess`를
   * false로 못박아 교직원·관리자를 뺀다(#1204 이전부터 그랬고 이 티켓은 건드리지 않는다).
   * 어긋남이 아니다 — 목록의 교직원 분기는 `viewerSubmission`을 아예 내려주지 않아 교직원에게는
   * 이 줄에서 누를 파일이 없고, 교직원은 자기 경로
   * (`documents/:documentId/applications/:applicationId/file`)로 받는다.
   *
   * 조회 범위는 여전히 이 학생이 속한 신청 하나다 — 남의 신청·남의 팀·무관한 프로그램에 닿는
   * 길은 생기지 않는다.
   */
  async findForParticipant(
    sessionGithubId: bigint,
    milestoneId: string,
    documentId: string,
  ): Promise<CurrentMilestoneDocumentFile | null> {
    const activeStudent = {
      githubId: sessionGithubId,
      accountStatus: AccountStatus.ACTIVE,
      hasStaffAccess: false,
      hasAdminAccess: false,
    } as const;
    const submission = await this.prisma.milestoneDocumentSubmission.findFirst({
      where: {
        milestoneDocumentId: documentId,
        milestoneDocument: {
          is: {
            milestoneId,
            kind: MilestoneDocumentKind.DOCUMENT,
          },
        },
        application: {
          is: {
            program: { is: { milestones: { some: { id: milestoneId } } } },
            team: {
              is: {
                OR: [
                  { leader: { is: activeStudent } },
                  { members: { some: { user: { is: activeStudent } } } },
                ],
              },
            },
          },
        },
      },
      select: {
        revision: true,
        files: {
          where: {
            lifecycle: SubmissionFileLifecycle.ATTACHED,
            expiresAt: { gt: new Date() },
          },
          orderBy: [
            {
              submissionHistory: {
                revision: { sort: 'desc', nulls: 'last' },
              },
            },
            { createdAt: 'desc' },
          ],
          take: 1,
          select: currentFileSelect.files.select,
        },
      },
    });
    const file = submission?.files[0];
    if (
      submission == null ||
      file == null ||
      file.submissionHistory?.revision !== submission.revision
    ) {
      return null;
    }
    return {
      storageKey: file.storageKey,
      originalFileName: file.originalFileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    };
  }
}
