import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateProgramRequestDto } from './dto/create-program-request.dto';
import type {
  ProgramListQuery,
  ProgramListQueryStatus,
} from './program-list-query';
import {
  PROGRAM_ERROR_CODES,
  ProgramErrorCode,
} from './program-error-code.enum';
import {
  getProgramTemplate,
  PROGRAM_PARTICIPATION,
} from './program-template.registry';

const PROGRAM_LIST_SELECT = {
  id: true,
  name: true,
  organizer: true,
  category: true,
  applicationStartAt: true,
  applicationEndAt: true,
  description: true,
} as const;

type ProgramListRecord = Prisma.ProgramGetPayload<{
  select: typeof PROGRAM_LIST_SELECT;
}>;

export interface ProgramListPage {
  readonly items: readonly ProgramListRecord[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

function recruitmentWhere(
  status: ProgramListQueryStatus,
  now: Date,
): Prisma.ProgramWhereInput {
  const whereByStatus = {
    all: {},
    recruiting: {
      applicationStartAt: { lte: now },
      applicationEndAt: { gte: now },
    },
    closed: { applicationEndAt: { lt: now } },
  } satisfies Readonly<
    Record<ProgramListQueryStatus, Prisma.ProgramWhereInput>
  >;
  return whereByStatus[status];
}

@Injectable()
export class ProgramsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: ProgramListQuery,
    now = new Date(),
  ): Promise<ProgramListPage> {
    const where: Prisma.ProgramWhereInput = {
      ...recruitmentWhere(query.status, now),
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' as const } }
        : {}),
    };
    const [items, totalItems] = await this.prisma.$transaction([
      this.prisma.program.findMany({
        where,
        orderBy: [
          { applicationStartAt: 'desc' },
          { name: 'asc' },
          { id: 'asc' },
        ],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: PROGRAM_LIST_SELECT,
      }),
      this.prisma.program.count({ where }),
    ]);

    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  async create(githubId: bigint, input: CreateProgramRequestDto) {
    const user = await this.prisma.user.findUnique({
      where: { githubId },
      select: { role: true },
    });
    if (user?.role !== Role.STAFF && user?.role !== Role.ADMIN) {
      throw new DomainException(
        PROGRAM_ERROR_CODES[ProgramErrorCode.FORBIDDEN],
      );
    }

    const name = input.name.trim();
    const organizer = input.organizer.trim();
    const description = input.description.trim();
    const applicationStartAt = new Date(input.applicationStartAt);
    const applicationEndAt = new Date(input.applicationEndAt);
    const template = getProgramTemplate(input.category);
    const hasValidDates =
      !Number.isNaN(applicationStartAt.getTime()) &&
      !Number.isNaN(applicationEndAt.getTime()) &&
      applicationEndAt >= applicationStartAt;
    const hasValidTeamSize =
      template.participation === PROGRAM_PARTICIPATION.INDIVIDUAL ||
      (input.teamMinSize !== null &&
        input.teamMinSize !== undefined &&
        input.teamMaxSize !== null &&
        input.teamMaxSize !== undefined &&
        input.teamMinSize >= 1 &&
        input.teamMinSize <= input.teamMaxSize);

    if (
      !name ||
      !organizer ||
      !description ||
      !hasValidDates ||
      !hasValidTeamSize
    ) {
      throw new DomainException(
        PROGRAM_ERROR_CODES[ProgramErrorCode.VALIDATION_ERROR],
      );
    }

    return this.prisma.program.create({
      data: {
        name,
        organizer,
        category: input.category,
        applicationTemplateKey: template.key,
        applicationTemplateVersion: template.version,
        applicationStartAt,
        applicationEndAt,
        teamMinSize:
          template.participation === PROGRAM_PARTICIPATION.TEAM
            ? input.teamMinSize
            : null,
        teamMaxSize:
          template.participation === PROGRAM_PARTICIPATION.TEAM
            ? input.teamMaxSize
            : null,
        description,
      },
    });
  }
}
