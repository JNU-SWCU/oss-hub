import { ProgramCategory, Role } from '@prisma/client';
import { DomainException } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateProgramRequestDto } from './dto/create-program-request.dto';
import {
  PROGRAM_ERROR_CODES,
  ProgramErrorCode,
} from './program-error-code.enum';
import { ProgramsService } from './programs.service';

const input: CreateProgramRequestDto = {
  name: '  2026 OSS Contest  ',
  organizer: '  SW Center  ',
  category: ProgramCategory.OSS_CONTEST,
  applicationStartAt: '2026-08-01T00:00:00+09:00',
  applicationEndAt: '2026-08-15T23:59:59+09:00',
  teamMinSize: 2,
  teamMaxSize: 4,
  description: '  Program overview  ',
};

describe('ProgramsService', () => {
  const findUnique = jest.fn();
  const create = jest.fn();
  const prisma = {
    user: { findUnique },
    program: { create },
  } as unknown as PrismaService;
  const service = new ProgramsService(prisma);

  beforeEach(() => {
    findUnique.mockReset();
    create.mockReset();
  });

  it('stores the server-owned OSS contest template for an approved staff member', async () => {
    findUnique.mockResolvedValue({ role: Role.STAFF });
    create.mockResolvedValue({ id: 'program-1' });

    await service.create(101n, input);

    expect(create).toHaveBeenCalledWith({
      data: {
        name: '2026 OSS Contest',
        organizer: 'SW Center',
        category: ProgramCategory.OSS_CONTEST,
        description: 'Program overview',
        applicationTemplateKey: 'oss-contest',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-08-01T00:00:00+09:00'),
        applicationEndAt: new Date('2026-08-15T23:59:59+09:00'),
        teamMinSize: 2,
        teamMaxSize: 4,
      },
    });
  });

  it('stores null team sizes for an individual template', async () => {
    findUnique.mockResolvedValue({ role: Role.ADMIN });
    create.mockResolvedValue({ id: 'program-2' });

    await service.create(101n, {
      ...input,
      category: ProgramCategory.BASIC,
      teamMinSize: 2,
      teamMaxSize: 4,
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        name: '2026 OSS Contest',
        organizer: 'SW Center',
        category: ProgramCategory.BASIC,
        description: 'Program overview',
        applicationTemplateKey: 'basic',
        applicationTemplateVersion: 1,
        applicationStartAt: new Date('2026-08-01T00:00:00+09:00'),
        applicationEndAt: new Date('2026-08-15T23:59:59+09:00'),
        teamMinSize: null,
        teamMaxSize: null,
      },
    });
  });

  it('rejects a reversed team range before a program is stored', async () => {
    findUnique.mockResolvedValue({ role: Role.STAFF });

    await expect(
      service.create(101n, { ...input, teamMinSize: 4, teamMaxSize: 2 }),
    ).rejects.toMatchObject<Partial<DomainException>>({
      errorCode: {
        code: ProgramErrorCode.VALIDATION_ERROR,
        message: PROGRAM_ERROR_CODES[ProgramErrorCode.VALIDATION_ERROR].message,
        status: 400,
      },
    });
    expect(create).not.toHaveBeenCalled();
  });
  it('rejects a student who bypasses the staff-only creation UI', async () => {
    findUnique.mockResolvedValue({ role: Role.STUDENT });

    await expect(service.create(101n, input)).rejects.toMatchObject<
      Partial<DomainException>
    >({
      errorCode: {
        code: ProgramErrorCode.FORBIDDEN,
        message: PROGRAM_ERROR_CODES[ProgramErrorCode.FORBIDDEN].message,
        status: 403,
      },
    });
    expect(create).not.toHaveBeenCalled();
  });
});
