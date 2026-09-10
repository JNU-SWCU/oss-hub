import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  createTeamCreatedAuditMetadata,
  createTeamMembershipAuditMetadata,
  TEAM_CREATED_AUDIT_ACTIONS,
  TEAM_MEMBERSHIP_AUDIT_ACTIONS,
} from '../../audit-log/audit-log-metadata';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { DomainException } from '../../common/error-code';
import {
  computeJoinCodeDigest,
  resolveJoinCodeSecretFromConfig,
} from '../../common/join-code-digest';
import type { RuntimeConfig } from '../../runtime-config/runtime-config';
import { RUNTIME_CONFIG } from '../../runtime-config/runtime-config.module';
import {
  JoinCodeDigestConflictError,
  ProgramTeamsRepository,
  TeamMembershipConflictError,
  type CreatedTeamRecord,
  type StaffTeamDetailRecord,
  type StaffTeamRecord,
  type TeamDetailRecord,
  type TeamMembershipAuditEvent,
  type TeamMembershipAuditStore,
  type TeamProgramRecord,
} from '../repository/program-teams.repository';
import { TEAMS_ERROR_CODES, TeamsErrorCode } from '../teams-error-code.enum';
import type {
  CreatedTeamView,
  ProgramTeamView,
  StaffTeamDetailView,
  StaffTeamView,
} from '../program-teams.types';

const JOIN_CODE_ATTEMPTS = 5;

/**
 * `Team.joinCodeDigest` 는 아직 NOT NULL·UNIQUE 컬럼이라 생성 시점에 한 번 채운다.
 * 참여코드로 합류하는 경로는 제거됐으므로 이 값을 다시 읽는 소비자는 없다.
 */
function generateJoinCode(): string {
  return randomBytes(6).toString('base64url').toUpperCase().slice(0, 10);
}

@Injectable()
export class ProgramTeamsService {
  private readonly joinCodeSecret: string;

  constructor(
    private readonly repository: ProgramTeamsRepository,
    @Inject(RUNTIME_CONFIG) runtimeConfig: RuntimeConfig,
    private readonly auditLog: AuditLogService,
  ) {
    this.joinCodeSecret = resolveJoinCodeSecretFromConfig(runtimeConfig);
  }

  async create(
    githubId: bigint,
    programId: string,
    name: string,
    now: Date = new Date(),
  ): Promise<CreatedTeamView> {
    const student = await this.requireStudent(githubId);
    const program = await this.requireOpenProgram(programId, now);
    const trimmedName = name.trim();

    let joinCode = '';
    let created: CreatedTeamRecord | null = null;

    for (let attempt = 0; attempt < JOIN_CODE_ATTEMPTS; attempt += 1) {
      joinCode = generateJoinCode();
      const joinCodeDigest = computeJoinCodeDigest(
        joinCode,
        this.joinCodeSecret,
      );
      try {
        created = await this.repository.withCreateTransaction(async (store) => {
          const existing = await store.findMembershipByProgramUser(
            programId,
            student.id,
          );
          if (existing) {
            throw this.error(TeamsErrorCode.ALREADY_IN_PROGRAM_TEAM);
          }
          const team = await store.createTeamWithLeader({
            programId,
            name: trimmedName,
            joinCodeDigest,
            leaderId: student.id,
          });
          await this.auditLog.record(
            {
              actorGithubId: githubId,
              action: TEAM_CREATED_AUDIT_ACTIONS.TEAM_CREATED,
              targetType: 'TEAM',
              targetId: team.id,
              metadata: createTeamCreatedAuditMetadata({
                programName: program.name,
                teamName: team.name,
              }),
            },
            store.auditLogWriter,
          );
          return team;
        });
        break;
      } catch (error) {
        if (error instanceof DomainException) throw error;
        if (error instanceof TeamMembershipConflictError) {
          throw this.error(TeamsErrorCode.ALREADY_IN_PROGRAM_TEAM);
        }
        if (error instanceof JoinCodeDigestConflictError) {
          continue;
        }
        throw error;
      }
    }

    if (!created) {
      throw new Error('join code digest collision retries exhausted');
    }

    // joinCode is returned once; never logged.
    return {
      id: created.id,
      name: created.name,
      joinCode,
      memberCount: 1,
    };
  }

  async getMe(githubId: bigint, programId: string): Promise<ProgramTeamView> {
    const student = await this.requireStudent(githubId);
    const program = await this.repository.findProgramById(programId);
    if (!program) {
      throw this.error(TeamsErrorCode.PROGRAM_NOT_FOUND);
    }

    const detail = await this.repository.findTeamDetailForUser(
      programId,
      student.id,
    );
    if (!detail) {
      throw this.error(TeamsErrorCode.TEAM_NOT_FOUND);
    }
    return this.toTeamView(detail, student.id);
  }

  /**
   * 본인 탈퇴 — 신청 제출 후에도, 신청 기간이 닫힌 뒤에도 허용한다. 팀장이 나가면
   * 남은 팀원 중 선임자가 자동 승계하고, 신청 기록이 있는 팀의 마지막 구성원만
   * 409로 막아 신청 이력을 보존한다.
   */
  async leave(githubId: bigint, programId: string): Promise<void> {
    const student = await this.requireStudent(githubId);
    const result = await this.repository.leave(
      programId,
      student.id,
      (store, event) => this.recordMembershipAudit(githubId, store, event),
    );
    if (result === 'not-found') {
      throw this.error(TeamsErrorCode.TEAM_NOT_FOUND);
    }
    if (result === 'last-member-with-application') {
      throw this.error(TeamsErrorCode.LAST_MEMBER_WITH_APPLICATION);
    }
  }

  /**
   * 팀장의 팀원 제외 — 팀장만 다른 현재 구성원을 제외한다. 본인 제외는 탈퇴가
   * 승계까지 책임지므로 409로 돌려보낸다. 다른 팀원·없는 사용자는 구분 없는 404다.
   */
  async removeMember(
    githubId: bigint,
    programId: string,
    targetUserId: string,
  ): Promise<void> {
    const student = await this.requireStudent(githubId);
    const result = await this.repository.removeMember(
      programId,
      student.id,
      targetUserId,
      (store, event) => this.recordMembershipAudit(githubId, store, event),
    );
    switch (result) {
      case 'removed':
        return;
      case 'actor-not-in-team':
        throw this.error(TeamsErrorCode.TEAM_NOT_FOUND);
      case 'not-leader':
        throw this.error(TeamsErrorCode.TEAM_LEADER_REQUIRED);
      case 'self-target':
        throw this.error(TeamsErrorCode.SELF_REMOVAL_REQUIRES_LEAVE);
      case 'target-not-found':
        throw this.error(TeamsErrorCode.TARGET_MEMBER_NOT_FOUND);
    }
  }

  /**
   * 멤버십 변경과 같은 트랜잭션에서 남기는 감사 기록. 실패하면 그대로 던져
   * 멤버 삭제·팀장 승계까지 롤백된다.
   */
  private async recordMembershipAudit(
    actorGithubId: bigint,
    store: TeamMembershipAuditStore,
    event: TeamMembershipAuditEvent,
  ): Promise<void> {
    await this.auditLog.record(
      {
        actorGithubId,
        action: TEAM_MEMBERSHIP_AUDIT_ACTIONS.TEAM_MEMBERSHIP_CHANGED,
        targetType: 'TEAM',
        targetId: event.teamId,
        metadata: createTeamMembershipAuditMetadata({
          programName: event.programName,
          teamName: event.teamName,
          operation: event.operation,
          removedUserId: event.removedUserId,
          previousLeaderId: event.previousLeaderId,
          nextLeaderId: event.nextLeaderId,
        }),
      },
      store.auditLogWriter,
    );
  }

  /**
   * 교직원 전용 팀 목록 — 팀원 전원의 실명을 포함한다(권한 검사는 ProgramTeamsStaffGuard).
   * 팀은 createdAt 오름차순, 멤버도 createdAt 오름차순이되 팀장만 맨 앞으로 끌어올린다.
   */
  async listForStaff(programId: string): Promise<StaffTeamView[]> {
    const program = await this.repository.findProgramById(programId);
    if (!program) {
      throw this.error(TeamsErrorCode.PROGRAM_NOT_FOUND);
    }
    const teams = await this.repository.listStaffTeams(programId);
    return teams.map((team) => this.toStaffTeamView(team));
  }

  /**
   * 교직원 전용 팀 상세(#874) — 팀원·신청 상태·저장소 발급 상태를 한 응답에 담는다.
   * 없는 팀·다른 프로그램의 팀은 구분 없이 같은 404(`TEAM_NOT_FOUND`)로 응답한다 —
   * repository 조회가 이미 `programId`로 걸러서 두 경우를 하나의 null로 합친다.
   */
  async getForStaff(
    programId: string,
    teamId: string,
  ): Promise<StaffTeamDetailView> {
    const detail = await this.repository.findStaffTeamDetail(programId, teamId);
    if (!detail) {
      throw this.error(TeamsErrorCode.TEAM_NOT_FOUND);
    }
    return this.toStaffTeamDetailView(detail);
  }

  private toStaffTeamDetailView(
    detail: StaffTeamDetailRecord,
  ): StaffTeamDetailView {
    const members = detail.members.map((member) => ({
      userId: member.userId,
      name: member.name,
      nickname: member.nickname,
      isLeader: member.userId === detail.leaderId,
    }));
    return {
      teamId: detail.id,
      name: detail.name,
      memberCount: members.length,
      members: [
        ...members.filter((member) => member.isLeader),
        ...members.filter((member) => !member.isLeader),
      ],
      application: detail.application,
    };
  }

  private toStaffTeamView(team: StaffTeamRecord): StaffTeamView {
    const members = team.members.map((member) => ({
      userId: member.userId,
      name: member.name,
      nickname: member.nickname,
      isLeader: member.userId === team.leaderId,
    }));
    return {
      teamId: team.id,
      name: team.name,
      memberCount: members.length,
      // createdAt 순서를 유지한 채 팀장만 앞으로 옮긴다(안정 분할).
      members: [
        ...members.filter((member) => member.isLeader),
        ...members.filter((member) => !member.isLeader),
      ],
    };
  }

  private async requireStudent(githubId: bigint) {
    const student = await this.repository.findActiveStudentByGithubId(githubId);
    if (!student) {
      throw this.error(TeamsErrorCode.STUDENT_ONLY);
    }
    return student;
  }

  private async requireOpenProgram(
    programId: string,
    now: Date,
  ): Promise<TeamProgramRecord> {
    const program = await this.repository.findProgramById(programId);
    if (!program) {
      throw this.error(TeamsErrorCode.PROGRAM_NOT_FOUND);
    }
    if (now < program.applicationStartAt || now > program.applicationEndAt) {
      throw this.error(TeamsErrorCode.APPLICATION_PERIOD_CLOSED);
    }
    return program;
  }

  /**
   * 권한 플래그는 서버가 계산한 미리보기일 뿐이다 — 실제 변경은 팀 행을 잠근 뒤
   * 다시 판정하는 mutation 경로가 여전히 권위다.
   */
  private toTeamView(
    detail: TeamDetailRecord,
    viewerUserId: string,
  ): ProgramTeamView {
    const memberCount = detail.members.length;
    const isLeader = detail.leaderId === viewerUserId;
    return {
      id: detail.id,
      name: detail.name,
      memberCount,
      minMembers: detail.teamMinSize,
      maxMembers: detail.teamMaxSize,
      hasApplication: detail.hasApplication,
      isLeader,
      canInvite: isLeader,
      canRemoveMembers: isLeader && memberCount > 1,
      canLeave: memberCount > 1 || !detail.hasApplication,
      members: detail.members.map((member) => ({
        userId: member.userId,
        nickname: member.nickname,
        name: member.name,
        isLeader: member.userId === detail.leaderId,
      })),
    };
  }

  private error(code: TeamsErrorCode): DomainException {
    return new DomainException(TEAMS_ERROR_CODES[code]);
  }
}
