import { Injectable } from '@nestjs/common';
import {
  MilestoneSubmissionType,
  Prisma,
  StaffAccessRequestStatus,
  SubmissionFileLifecycle,
} from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';
// 공용 영속성 도구 — 서류 항목 행 잠금 문장과 전역 잠금 순서 규칙은 common이 한 벌만 갖는다.
// 마일스톤 삭제 경로와 학생 제출 경로가 **같은 행**을 잠가야 직렬화되므로 여기서 다시 쓰지 않는다.
import { lockMilestoneDocumentsOfMilestone } from '../../common/milestone-document-locks';
import { PrismaService } from '../../prisma/prisma.service';
import { readProgramDeletionScopeCounts } from '../program-deletion-scope';
import type {
  EditableProgramView,
  ProgramDeletionScopeCounts,
  ProgramCategoryLockState,
  ProgramEditorRepositoryPort,
  ProgramEditorTransactionStore,
  ProgramMilestoneCreateInput,
  ProgramMilestoneDeleteTarget,
  ProgramMilestoneTarget,
  ProgramMilestoneUpdateInput,
  ProgramMilestoneView,
  ProgramSchedule,
  ProgramUpdateInput,
} from '../program-editor.types';

type ProgramRecord = PrismaTypes.ProgramGetPayload<{
  include: typeof editableProgramInclude;
}>;
type MilestoneRecord = PrismaTypes.MilestoneGetPayload<Record<string, never>>;
type LockedProgramRow = Readonly<{ id: string }>;
type LockedMilestoneRow = Readonly<{ id: string; programId: string }>;

class PrismaProgramEditorStore implements ProgramEditorTransactionStore {
  constructor(private readonly transaction: PrismaTypes.TransactionClient) {}

  findUserAuthorityByGithubId(githubId: bigint) {
    return this.transaction.user.findUnique({
      where: { githubId },
      select: {
        hasStaffAccess: true,
        hasAdminAccess: true,
        accountStatus: true,
        staffAccessRequests: {
          where: { status: StaffAccessRequestStatus.PENDING },
          select: { status: true },
          take: 1,
        },
      },
    });
  }

  async findEditableProgramById(
    programId: string,
  ): Promise<EditableProgramView | null> {
    const [program, deletionScopeCounts] = await Promise.all([
      this.transaction.program.findUnique({
        where: { id: programId },
        include: editableProgramInclude,
      }),
      this.readDeletionScopeCounts(programId),
    ]);
    return program ? toEditableProgramView(program, deletionScopeCounts) : null;
  }

  async findEditableProgramForUpdate(
    programId: string,
  ): Promise<EditableProgramView | null> {
    const locked = await this.lockProgram(programId);
    return locked ? this.findEditableProgramById(programId) : null;
  }

  async updateProgram(input: ProgramUpdateInput): Promise<EditableProgramView> {
    if (input.liveFileExpiresAt !== null) {
      await this.transaction.submissionFile.updateMany({
        where: {
          application: { programId: input.programId },
          lifecycle: {
            in: [
              SubmissionFileLifecycle.PENDING,
              SubmissionFileLifecycle.ATTACHED,
            ],
          },
          deletedAt: null,
        },
        data: { expiresAt: input.liveFileExpiresAt },
      });
    }
    const program = await this.transaction.program.update({
      where: { id: input.programId },
      data: {
        name: input.name,
        organizer: input.organizer,
        category: input.category,
        applicationTemplateKey: input.applicationTemplateKey,
        applicationTemplateVersion: input.applicationTemplateVersion,
        applicationStartAt: input.applicationStartAt,
        applicationEndAt: input.applicationEndAt,
        startAt: input.startAt,
        endAt: input.endAt,
        teamMinSize: input.teamMinSize,
        teamMaxSize: input.teamMaxSize,
        repositoryProvisioningEnabled: input.repositoryProvisioningEnabled,
        notifyOnDeadline: input.notifyOnDeadline,
        description: input.description,
      },
      include: editableProgramInclude,
    });
    return toEditableProgramView(
      program,
      await this.readDeletionScopeCounts(input.programId),
    );
  }

  /** 한 SQL 문장의 snapshot으로 전체 삭제 전 사용자에게 보일 범위를 읽는다 —
   * purge 트랜잭션의 재확인과 같은 쿼리를 쓴다(program-deletion-scope.ts). */
  private readDeletionScopeCounts(
    programId: string,
  ): Promise<ProgramDeletionScopeCounts> {
    return readProgramDeletionScopeCounts(this.transaction, programId);
  }

  async findProgramScheduleForMilestoneCreate(
    programId: string,
  ): Promise<ProgramSchedule | null> {
    const locked = await this.lockProgram(programId);
    if (!locked) return null;
    return this.transaction.program.findUnique({
      where: { id: programId },
      select: { id: true, startAt: true, endAt: true },
    });
  }

  async createMilestone(
    input: ProgramMilestoneCreateInput,
  ): Promise<ProgramMilestoneView> {
    const milestone = await this.transaction.milestone.create({
      data: {
        ...input,
        documents: {
          create: {
            name: '제출 항목 1',
            required: true,
            sortOrder: 1,
            submissionType: MilestoneSubmissionType.FILE,
          },
        },
      },
    });
    return toMilestoneView(milestone);
  }

  async findMilestoneForUpdate(
    milestoneId: string,
  ): Promise<ProgramMilestoneTarget | null> {
    const programId = await this.findMilestoneProgramId(milestoneId);
    if (programId === null) return null;
    const programLocked = await this.lockProgram(programId);
    if (!programLocked) return null;
    const lockedMilestone = await this.lockMilestone(milestoneId);
    if (lockedMilestone === null || lockedMilestone.programId !== programId) {
      return null;
    }
    const milestone = await this.transaction.milestone.findUnique({
      where: { id: milestoneId },
      include: {
        program: { select: { startAt: true, endAt: true } },
      },
    });
    if (milestone === null || milestone.programId !== programId) return null;
    return {
      ...toMilestoneView(milestone),
      programId: milestone.programId,
      programStartAt: milestone.program.startAt,
      endAt: milestone.program.endAt,
    };
  }

  async updateMilestone(
    input: ProgramMilestoneUpdateInput,
  ): Promise<ProgramMilestoneView> {
    const milestone = await this.transaction.milestone.update({
      where: { id: input.milestoneId },
      data: {
        name: input.name,
        startAt: input.startAt,
        dueAt: input.dueAt,
        submissionType: input.submissionType,
        instructions: input.instructions,
      },
    });
    return toMilestoneView(milestone);
  }

  async findMilestoneForDelete(
    milestoneId: string,
  ): Promise<ProgramMilestoneDeleteTarget | null> {
    const programId = await this.findMilestoneProgramId(milestoneId);
    if (programId === null) return null;
    const programLocked = await this.lockProgram(programId);
    if (!programLocked) return null;
    const lockedMilestone = await this.lockMilestone(milestoneId);
    if (lockedMilestone === null || lockedMilestone.programId !== programId) {
      return null;
    }
    // 마일스톤 행만 잠그면 학생 제출과 직렬화되지 않는다 — 학생 제출 경로는 마일스톤이 아니라
    // `MilestoneDocument` 행을 잠근다. 서로 다른 행이라 삭제 쪽이 제출 수 0을 본 뒤 학생 제출이
    // 커밋되고, 이어지는 서류 항목 삭제가 FK(P2003)로 터져 타입 없는 500이 된다. 그래서 **세기
    // 전에** 학생 제출 경로가 잡는 바로 그 행들을 잠근다. 부모 먼저(Program → Milestone →
    // MilestoneDocument) 순서는 그대로 유지한다.
    await lockMilestoneDocumentsOfMilestone(this.transaction, milestoneId);
    const milestone = await this.transaction.milestone.findUnique({
      where: { id: milestoneId },
      include: {
        _count: {
          select: {
            submissions: true,
            submissionFiles: {
              where: {
                lifecycle: {
                  in: [
                    SubmissionFileLifecycle.PENDING,
                    SubmissionFileLifecycle.ATTACHED,
                  ],
                },
                deletedAt: null,
              },
            },
          },
        },
        program: { include: { _count: { select: { milestones: true } } } },
      },
    });
    if (milestone === null || milestone.programId !== programId) return null;
    // 서류 항목의 제출은 Milestone에서 한 단계 더 들어간 테이블이라 _count로 세지 못한다.
    // 같은 트랜잭션에서, 위 서류 항목 행 잠금 뒤에 센다 — 이 순서가 뒤집히면 세는 값이 낡는다.
    const documentSubmissionCount =
      await this.transaction.milestoneDocumentSubmission.count({
        where: { milestoneDocument: { milestoneId } },
      });
    return {
      id: milestone.id,
      programId: milestone.programId,
      submissionCount:
        milestone._count.submissions + milestone._count.submissionFiles,
      documentSubmissionCount,
      programMilestoneCount: milestone.program._count.milestones,
      programRepositoryProvisioningEnabled:
        milestone.program.repositoryProvisioningEnabled,
    };
  }

  /**
   * 서류 항목은 마일스톤 없이는 뜻이 없는 설정이라 마일스톤과 함께 지운다. FK가 모두
   * ON DELETE RESTRICT(Prisma 기본)라 순서도 강제된다: 양식 파일 행 → 서류 항목 행 →
   * 마일스톤. 이 순서를 지키지 않으면 P2003이 발생해 타입 없는 500이 된다.
   *
   * ⚠ 지우는 것은 DB 행뿐이다 — 양식 파일의 스토리지 객체(MilestoneDocumentTemplateFile.
   * storageKey가 가리키는 객체)는 스토리지에 그대로 남는다. 고아 객체 회수는 이 경로의
   * 책임이 아니라 별도 이슈에서 다룬다(milestone-documents의 deleteDocument도 같은 상태다).
   *
   * 제출물이 하나라도 있으면 서비스 계층이 MILESTONE_HAS_SUBMISSIONS로 먼저 막으므로,
   * 여기까지 온 마일스톤에는 MilestoneDocumentSubmission이 없다.
   */
  async deleteMilestone(milestoneId: string): Promise<void> {
    await this.transaction.milestoneDocumentTemplateFile.deleteMany({
      where: { milestoneDocument: { milestoneId } },
    });
    await this.transaction.milestoneDocument.deleteMany({
      where: { milestoneId },
    });
    await this.transaction.milestone.delete({ where: { id: milestoneId } });
  }

  private async findMilestoneProgramId(
    milestoneId: string,
  ): Promise<string | null> {
    const milestone = await this.transaction.milestone.findUnique({
      where: { id: milestoneId },
      select: { programId: true },
    });
    return milestone?.programId ?? null;
  }

  private async lockProgram(programId: string): Promise<boolean> {
    const rows = await this.transaction.$queryRaw<readonly LockedProgramRow[]>(
      Prisma.sql`SELECT id FROM "Program" WHERE id = ${programId} FOR UPDATE`,
    );
    return rows.length === 1;
  }

  private async lockMilestone(
    milestoneId: string,
  ): Promise<LockedMilestoneRow | null> {
    const rows = await this.transaction.$queryRaw<
      readonly LockedMilestoneRow[]
    >(
      Prisma.sql`SELECT id, "programId" FROM "Milestone" WHERE id = ${milestoneId} FOR UPDATE`,
    );
    return rows[0] ?? null;
  }
}

@Injectable()
export class ProgramEditorRepository implements ProgramEditorRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  withTransaction<T>(
    operation: (store: ProgramEditorTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(new PrismaProgramEditorStore(transaction)),
    );
  }
}

const editableProgramInclude = {
  _count: { select: { applications: true, teams: true, boardPosts: true } },
  milestones: { orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }] },
} satisfies PrismaTypes.ProgramInclude;

function toEditableProgramView(
  program: ProgramRecord,
  deletionScopeCounts: ProgramDeletionScopeCounts,
): EditableProgramView {
  return {
    id: program.id,
    name: program.name,
    organizer: program.organizer,
    category: program.category,
    lifecycle: program.lifecycle,
    applicationTemplateKey: program.applicationTemplateKey,
    applicationTemplateVersion: program.applicationTemplateVersion,
    applicationCount: program._count.applications,
    teamCount: program._count.teams,
    deletionScopeCounts,
    categoryLocked: toCategoryLockState(program._count),
    applicationStartAt: program.applicationStartAt,
    applicationEndAt: program.applicationEndAt,
    startAt: program.startAt,
    endAt: program.endAt.toISOString(),
    teamMinSize: program.teamMinSize,
    teamMaxSize: program.teamMaxSize,
    repositoryProvisioningEnabled: program.repositoryProvisioningEnabled,
    notifyOnDeadline: program.notifyOnDeadline,
    deletionProtected: program.deletionProtected,
    description: program.description,
    milestones: program.milestones.map(toMilestoneView),
  };
}

function toCategoryLockState(counts: {
  readonly applications: number;
  readonly teams: number;
}): ProgramCategoryLockState {
  const byApplications = counts.applications > 0;
  const byTeams = counts.teams > 0;
  return {
    locked: byApplications || byTeams,
    byApplications,
    byTeams,
    applicationCount: counts.applications,
    teamCount: counts.teams,
  };
}

function toMilestoneView(milestone: MilestoneRecord): ProgramMilestoneView {
  return {
    id: milestone.id,
    name: milestone.name,
    startAt: milestone.startAt,
    dueAt: milestone.dueAt,
    submissionType: milestone.submissionType,
    instructions: milestone.instructions,
  };
}
