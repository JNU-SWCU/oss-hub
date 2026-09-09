import { Injectable } from '@nestjs/common';
import { ProgramLifecycle } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PROGRAM_COVER_MAX_BYTES,
  PROGRAM_COVER_STORAGE_PREFIX,
} from '../program-cover';

@Injectable()
export class ProgramCoverRepository {
  constructor(private readonly prisma: PrismaService) {}

  findPublicCover(programId: string, coverId: string) {
    return this.prisma.programCover.findFirst({
      where: {
        id: coverId,
        programId,
        program: {
          lifecycle: {
            in: [ProgramLifecycle.PUBLISHED, ProgramLifecycle.ARCHIVED],
          },
        },
        storageKey: { startsWith: PROGRAM_COVER_STORAGE_PREFIX },
        mimeType: { in: ['image/jpeg', 'image/png'] },
        sizeBytes: { gte: 1, lte: PROGRAM_COVER_MAX_BYTES },
      },
      select: { storageKey: true, mimeType: true, sizeBytes: true },
    });
  }
}
