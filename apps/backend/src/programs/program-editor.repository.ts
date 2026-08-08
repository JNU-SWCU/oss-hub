import { Injectable } from '@nestjs/common';
import {
  Prisma,
  RoleRequestStatus,
  SubmissionFileLifecycle,
} from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  EditableProgramView,
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
} from './program-editor.types';

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
        role: true,
        accountStatus: true,
        roleRequests: {
          where: { status: RoleRequestStatus.PENDING },
          select: { status: true },
          take: 1,
        },
      },
    });
  }

  async findEditableProgramById(
    programId: string,
  ): Promise<EditableProgramView | null> {
    const program = await this.transaction.program.findUnique({
      where: { id: programId },
      include: editableProgramInclude,
    });
    return program ? toEditableProgramView(program) : null;
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
        endAt: input.endAt,
        teamMinSize: input.teamMinSize,
        teamMaxSize: input.teamMaxSize,
        repositoryProvisioningEnabled: input.repositoryProvisioningEnabled,
        description: input.description,
      },
      include: editableProgramInclude,
    });
    return toEditableProgramView(program);
  }

  async findProgramScheduleForMilestoneCreate(
    programId: string,
  ): Promise<ProgramSchedule | null> {
    const locked = await this.lockProgram(programId);
    if (!locked) return null;
    return this.transaction.program.findUnique({
      where: { id: programId },
      select: { id: true, applicationEndAt: true, endAt: true },
    });
  }

  async createMilestone(
    input: ProgramMilestoneCreateInput,
  ): Promise<ProgramMilestoneView> {
    const milestone = await this.transaction.milestone.create({
      data: input,
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
        program: { select: { applicationEndAt: true, endAt: true } },
      },
    });
    if (milestone === null || milestone.programId !== programId) return null;
    return {
      ...toMilestoneView(milestone),
      programId: milestone.programId,
      applicationEndAt: milestone.program.applicationEndAt,
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
    // 같은 트랜잭션(= 위에서 마일스톤을 FOR UPDATE로 잠근 뒤)에서 따로 센다.
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
  _count: { select: { applications: true, teams: true } },
  milestones: { orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }] },
} satisfies PrismaTypes.ProgramInclude;

function toEditableProgramView(program: ProgramRecord): EditableProgramView {
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
    categoryLocked: toCategoryLockState(program._count),
    applicationStartAt: program.applicationStartAt,
    applicationEndAt: program.applicationEndAt,
    endAt: program.endAt?.toISOString() ?? null,
    teamMinSize: program.teamMinSize,
    teamMaxSize: program.teamMaxSize,
    repositoryProvisioningEnabled: program.repositoryProvisioningEnabled,
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
    dueAt: milestone.dueAt,
    submissionType: milestone.submissionType,
    instructions: milestone.instructions,
  };
}
