import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { DomainException } from '../common/error-code';
import { ProgramAuthoringRepository } from './program-authoring.repository';
import { PROGRAM_NOTICE_ERRORS } from './program-notice-error-code';
import {
  extractProgramNotice,
  type ProgramNoticePreview,
} from './program-notice-extraction';
import { ProgramNoticeFetchClient } from './program-notice-fetch.client';
import { parseProgramNoticeUrl } from './program-notice-url';

@Injectable()
export class ProgramNoticePreviewService {
  private active = 0;
  // Per-process rolling window is capped at 60 entries; no persistent draft/cache.
  private attempts: { readonly actorId: string; readonly at: number }[] = [];

  constructor(
    @Inject(ProgramAuthoringRepository)
    private readonly repository: Pick<ProgramAuthoringRepository, 'findActor'>,
    @Inject(ProgramNoticeFetchClient)
    private readonly client: Pick<ProgramNoticeFetchClient, 'read'>,
  ) {}

  async preview(
    githubId: bigint,
    input: string,
  ): Promise<ProgramNoticePreview> {
    const actor = await this.repository.findActor(githubId);
    if (
      !actor ||
      actor.accountStatus !== 'ACTIVE' ||
      (!actor.hasStaffAccess && !actor.hasAdminAccess)
    )
      throw new ConflictException('Program authoring is unavailable.');
    const source = parseProgramNoticeUrl(input);
    const now = Date.now();
    this.attempts = this.attempts.filter(
      (attempt) => attempt.at > now - 60_000,
    );
    if (
      this.active >= 4 ||
      this.attempts.length >= 60 ||
      this.attempts.filter((attempt) => attempt.actorId === actor.id).length >=
        6
    )
      throw new DomainException(PROGRAM_NOTICE_ERRORS.RATE_LIMITED);
    this.attempts.push({ actorId: actor.id, at: now });
    this.active++;
    try {
      return extractProgramNotice(await this.client.read(source), source);
    } finally {
      this.active--;
    }
  }
}
