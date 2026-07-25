import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DomainException } from '../common/error-code';
import { computeJoinCodeDigest } from '../common/join-code-digest';
import {
  getProgramTemplate,
  PROGRAM_PARTICIPATION,
} from './program-template.registry';
import {
  JoinCodeDigestConflictError,
  ProgramTeamsRepository,
  TeamMembershipConflictError,
  type CreatedTeamRecord,
  type TeamDetailRecord,
  type TeamProgramRecord,
} from './program-teams.repository';
import { TEAMS_ERROR_CODES, TeamsErrorCode } from './teams-error-code.enum';
import type { CreatedTeamView, ProgramTeamView } from './program-teams.types';

const JOIN_CODE_ATTEMPTS = 5;

function generateJoinCode(): string {
  return randomBytes(6).toString('base64url').toUpperCase().slice(0, 10);
}

@Injectable()
export class ProgramTeamsService {
  constructor(private readonly repository: ProgramTeamsRepository) {}

  async create(
    githubId: bigint,
    programId: string,
    name: string,
    now: Date = new Date(),
  ): Promise<CreatedTeamView> {
    const student = await this.requireStudent(githubId);
    await this.requireTeamProgram(programId, now);
    const trimmedName = name.trim();

    let joinCode = '';
    let created: CreatedTeamRecord | null = null;

    for (let attempt = 0; attempt < JOIN_CODE_ATTEMPTS; attempt += 1) {
      joinCode = generateJoinCode();
      const joinCodeDigest = computeJoinCodeDigest(joinCode);
      try {
        created = await this.repository.withCreateTransaction(async (store) => {
          const existing = await store.findMembershipByProgramUser(
            programId,
            student.id,
          );
          if (existing) {
            throw this.error(TeamsErrorCode.ALREADY_IN_PROGRAM_TEAM);
          }
          return store.createTeamWithLeader({
            programId,
            name: trimmedName,
            joinCodeDigest,
            leaderId: student.id,
          });
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
    const program = await this.requireTeamProgram(programId, now);
    const maxSize = program.teamMaxSize as number;
    const normalizedCode = joinCode.trim();
    if (!normalizedCode) {
      throw this.error(TeamsErrorCode.JOIN_CODE_NOT_FOUND);
    }
    const joinCodeDigest = computeJoinCodeDigest(normalizedCode);

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
        if (team.memberCount >= maxSize) {
          throw this.error(TeamsErrorCode.TEAM_FULL);
        }

        await store.addMember(team.id, programId, student.id);
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
    this.assertTeamParticipation(program);

    const detail = await this.repository.findTeamDetailForUser(
      programId,
      student.id,
    );
    if (!detail) {
      throw this.error(TeamsErrorCode.TEAM_NOT_FOUND);
    }
    return this.toTeamView(detail, student.id);
  }

  private async requireStudent(githubId: bigint) {
    const student = await this.repository.findActiveStudentByGithubId(githubId);
    if (!student) {
      throw this.error(TeamsErrorCode.STUDENT_ONLY);
    }
    return student;
  }

  private async requireTeamProgram(
    programId: string,
    now: Date,
  ): Promise<TeamProgramRecord> {
    const program = await this.repository.findProgramById(programId);
    if (!program) {
      throw this.error(TeamsErrorCode.PROGRAM_NOT_FOUND);
    }
    this.assertTeamParticipation(program);
    if (now < program.applicationStartAt || now > program.applicationEndAt) {
      throw this.error(TeamsErrorCode.APPLICATION_PERIOD_CLOSED);
    }
    if (program.teamMaxSize == null) {
      throw this.error(TeamsErrorCode.TEAM_SIZE_MISCONFIGURED);
    }
    return program;
  }

  private assertTeamParticipation(program: TeamProgramRecord): void {
    const template = getProgramTemplate(program.category);
    if (template.participation === PROGRAM_PARTICIPATION.INDIVIDUAL) {
      throw this.error(TeamsErrorCode.TEAM_NOT_ALLOWED);
    }
  }

  private toTeamView(
    detail: TeamDetailRecord,
    viewerUserId: string,
  ): ProgramTeamView {
    if (detail.teamMaxSize == null) {
      throw this.error(TeamsErrorCode.TEAM_SIZE_MISCONFIGURED);
    }
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
