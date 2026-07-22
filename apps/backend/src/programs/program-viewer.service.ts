import { Injectable } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import type { Role } from '@prisma/client';
import type { ProgramViewerRoleResponseDto } from './dto/program-detail.dto';
import { ProgramsRepository } from './programs.repository';

export interface ProgramViewer {
  readonly githubId: bigint | null;
  readonly userId: string | null;
  readonly role: ProgramViewerRoleResponseDto;
}

@Injectable()
export class ProgramViewerService {
  constructor(private readonly repository: ProgramsRepository) {}

  async fromGithubId(githubId: bigint | null): Promise<ProgramViewer> {
    if (githubId === null) return { githubId: null, userId: null, role: null };

    const user = await this.repository.findViewer(githubId);
    if (!user || user.accountStatus !== AccountStatus.ACTIVE)
      return { githubId, userId: null, role: null };

    const role: Role | 'PENDING' | null =
      user.role ?? (user.roleRequests.length > 0 ? 'PENDING' : null);
    return { githubId, userId: user.id, role };
  }
}
