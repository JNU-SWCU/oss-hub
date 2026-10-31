import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  resolveJoinCodeSecretFromConfig,
  computeJoinCodeDigest,
} from '../platform/join-code-secret.config';
import type { RuntimeConfig } from '../platform/runtime-config.config';
import { RUNTIME_CONFIG } from '../platform/runtime-config-instance.config';
import { DomainException, type ErrorCode } from '../platform/error-code.error';
import { ApplicationPreparationsRepository } from './application-preparations.repository';
import {
  PreparationConflict,
  type PreparationFailure,
} from './application-preparation.error';

@Injectable()
export class ApplicationJoinCodeService {
  private readonly joinCodeSecret: string;

  constructor(
    @Inject(RUNTIME_CONFIG)
    runtimeConfig: Pick<RuntimeConfig, 'TEAM_JOIN_CODE_SECRET'>,
  ) {
    this.joinCodeSecret = resolveJoinCodeSecretFromConfig(runtimeConfig);
  }

  generateJoinCode(): string {
    return randomBytes(6).toString('base64url').toUpperCase().slice(0, 10);
  }

  computeJoinCodeDigest(joinCode: string): string {
    return computeJoinCodeDigest(joinCode, this.joinCodeSecret);
  }
}

const ERRORS = {
  'not-found': {
    code: 'APP_030',
    status: 404,
    message: '신청 준비 또는 초대를 찾을 수 없습니다.',
  },
  'leader-required': {
    code: 'TIV_003',
    status: 403,
    message: '준비를 시작한 팀장만 관리할 수 있습니다.',
  },
  'member-required': {
    code: 'TIV_004',
    status: 403,
    message: '본인이 참여하는 신청 준비만 관리할 수 있습니다.',
  },
  'period-closed': {
    code: 'APP_010',
    status: 422,
    message: '신청 기간이 아닙니다.',
  },
  'membership-conflict': {
    code: 'TIV_007',
    status: 409,
    message: '이미 이 프로그램의 팀 또는 신청 준비에 참여하고 있습니다.',
  },
  full: {
    code: 'TIV_009',
    status: 409,
    message: '팀 최대 인원을 초과할 수 없습니다.',
  },
  'not-pending': {
    code: 'TIV_011',
    status: 409,
    message: '이미 대기 중이거나 처리된 초대입니다.',
  },
  ineligible: {
    code: 'TIV_013',
    status: 422,
    message: '활성 학생 계정만 신청 준비에 참여할 수 있습니다.',
  },
  'self-invite': {
    code: 'TIV_005',
    status: 422,
    message: '자기 자신을 초대할 수 없습니다.',
  },
} as const satisfies Record<PreparationFailure, ErrorCode>;

@Injectable()
export class ApplicationPreparationsService {
  constructor(private readonly repository: ApplicationPreparationsRepository) {}

  private async run<T>(
    githubId: bigint,
    operation: (actorId: string) => Promise<T>,
  ): Promise<T> {
    const actorId = await this.repository.findActor(githubId);
    if (actorId === null)
      throw new DomainException({
        code: 'APP_008',
        status: 403,
        message: '활성 계정으로 로그인해 주세요.',
      });
    try {
      return await operation(actorId);
    } catch (error) {
      if (error instanceof PreparationConflict)
        throw new DomainException(ERRORS[error.reason]);
      throw error;
    }
  }

  get(githubId: bigint, programId: string) {
    return this.run(githubId, (actorId) =>
      this.repository.get(programId, actorId),
    );
  }
  create(githubId: bigint, programId: string, name: string, now = new Date()) {
    return this.run(githubId, (actorId) =>
      this.repository.create(programId, actorId, name.trim(), now),
    );
  }
  listSent(githubId: bigint, preparationId: string) {
    return this.run(githubId, (actorId) =>
      this.repository.listSent(preparationId, actorId),
    );
  }
  search(githubId: bigint, preparationId: string, query: string) {
    return this.run(githubId, (actorId) =>
      this.repository.search(preparationId, actorId, query),
    );
  }
  invite(
    githubId: bigint,
    preparationId: string,
    inviteeId: string,
    now = new Date(),
  ) {
    return this.run(githubId, (actorId) =>
      this.repository.invite(preparationId, actorId, inviteeId, now),
    );
  }
  respond(
    githubId: bigint,
    invitationId: string,
    action: 'accept' | 'decline' | 'cancel',
    now = new Date(),
  ) {
    return this.run(githubId, (actorId) =>
      this.repository.respond(invitationId, actorId, action, now),
    );
  }
  remove(githubId: bigint, programId: string, memberId: string) {
    return this.run(githubId, (actorId) =>
      this.repository.remove(programId, actorId, memberId),
    );
  }
  leave(githubId: bigint, programId: string) {
    return this.run(githubId, (actorId) =>
      this.repository.remove(programId, actorId, actorId),
    );
  }
}
