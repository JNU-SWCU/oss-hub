import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  createTeamCreatedAuditMetadata,
  createTeamJoinedAuditMetadata,
  TEAM_CREATED_AUDIT_ACTIONS,
  TEAM_JOINED_AUDIT_ACTIONS,
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

  async join(
    githubId: bigint,
    programId: string,
    joinCode: string,
    now: Date = new Date(),
  ): Promise<ProgramTeamView> {
    const student = await this.requireStudent(githubId);
    const program = await this.requireOpenProgram(programId, now);
    const normalizedCode = joinCode.trim();
    if (!normalizedCode) {
      throw this.error(TeamsErrorCode.JOIN_CODE_NOT_FOUND);
    }
    const joinCodeDigest = computeJoinCodeDigest(
      normalizedCode,
      this.joinCodeSecret,
    );

    try {
      await this.repository.withJoinTransaction(async (store) => {
        const existing = await store.findMembershipByProgramUser(
          programId,
          student.id,
        );
        if (existing) {
          throw this.error(TeamsErrorCode.ALREADY_IN_PROGRAM_TEAM);
        }

        const team = await store.findTeamByJoinCodeDigest(
          programId,
          joinCodeDigest,
        );
        if (!team) {
          throw this.error(TeamsErrorCode.JOIN_CODE_NOT_FOUND);
        }
        if (team.hasApplication) {
          throw this.error(TeamsErrorCode.TEAM_LOCKED_AFTER_APPLICATION);
        }
        if (team.memberCount >= program.teamMaxSize) {
          throw this.error(TeamsErrorCode.TEAM_FULL);
        }

        // #164 패턴: 팀 행을 FOR UPDATE로 잠근 뒤 정원·잠금 판정을 다시 읽어
        // 확정한다. 위의 findTeamByJoinCodeDigest 스냅샷은 잠금 전이라 동시
        // 합류 경합 아래 stale할 수 있으므로, 실제 삽입 여부는 이 재조회
        // 값만 근거로 삼는다.
        const locked = await store.lockTeamForJoin(team.id);
        if (locked.hasApplication) {
          throw this.error(TeamsErrorCode.TEAM_LOCKED_AFTER_APPLICATION);
        }
        if (locked.memberCount >= program.teamMaxSize) {
          throw this.error(TeamsErrorCode.TEAM_FULL);
        }

        await store.addMember(team.id, programId, student.id);
        await this.auditLog.record(
          {
            actorGithubId: githubId,
            action: TEAM_JOINED_AUDIT_ACTIONS.TEAM_JOINED,
            targetType: 'TEAM',
            targetId: team.id,
            metadata: createTeamJoinedAuditMetadata({
              programName: program.name,
              teamName: team.name,
            }),
          },
          store.auditLogWriter,
        );
      });
    } catch (error) {
      if (error instanceof DomainException) throw error;
      if (error instanceof TeamMembershipConflictError) {
        throw this.error(TeamsErrorCode.ALREADY_IN_PROGRAM_TEAM);
      }
      throw error;
    }

    return this.getMe(githubId, programId);
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

  async leave(
    githubId: bigint,
    programId: string,
    now: Date = new Date(),
  ): Promise<void> {
    const student = await this.requireStudent(githubId);
    await this.requireOpenProgram(programId, now);
    const result = await this.repository.leave(programId, student.id);
    if (result === 'not-found') {
      throw this.error(TeamsErrorCode.TEAM_NOT_FOUND);
    }
    if (result === 'locked') {
      throw this.error(TeamsErrorCode.TEAM_LOCKED_AFTER_APPLICATION);
    }
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

  private toTeamView(
    detail: TeamDetailRecord,
    viewerUserId: string,
  ): ProgramTeamView {
    return {
      id: detail.id,
      name: detail.name,
      memberCount: detail.members.length,
      minMembers: detail.teamMinSize,
      maxMembers: detail.teamMaxSize,
      locked: detail.hasApplication,
      isLeader: detail.leaderId === viewerUserId,
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
