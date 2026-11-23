import type { JobDraft } from './mail-job.types';
import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import type { ActiveAccountPrincipal } from '../auth/http-auth.types';
import { DeadlineDigestService } from './deadline-digest.service';
import { ProgramMailService } from './program-mail.service';
import { MailJobConfig } from './mail-job.config';

@Injectable()
export class MailJobsService {
  constructor(
    private readonly program: ProgramMailService,
    private readonly deadline: DeadlineDigestService,
  ) {}
  async preview(
    id: string,
    actor: ActiveAccountPrincipal,
    body: JobDraft<
      Parameters<ProgramMailService['preview']>[2],
      Parameters<DeadlineDigestService['previewProgramFromRequest']>[1]
    >,
  ) {
    if (body.kind === 'PROGRAM')
      return {
        kind: 'PROGRAM' as const,
        preview: await this.program.preview(id, actor, body.draft),
      };
    const preview = await this.deadline.previewProgramFromRequest(
      id,
      body.draft,
    );
    return {
      kind: 'DEADLINE' as const,
      preview: {
        ...preview,
        previewVersion: MailJobConfig.digest([
          'deadline-v1',
          id,
          actor.id,
          preview.previewVersion,
        ]),
      },
    };
  }
  async accept(
    id: string,
    actor: ActiveAccountPrincipal,
    body: JobDraft<
      Parameters<ProgramMailService['accept']>[2],
      Parameters<DeadlineDigestService['accept']>[1]
    >,
    res: Response,
  ) {
    const jobId =
      body.kind === 'PROGRAM'
        ? await this.program.accept(id, actor, body.draft)
        : (await this.deadline.accept(id, body.draft, actor.id)).jobId;
    res.location(
      `/api/v1/programs/${encodeURIComponent(id)}/mail/jobs/${encodeURIComponent(jobId)}`,
    );
    return { jobId, status: (await this.program.status(id, jobId)).status };
  }
}
