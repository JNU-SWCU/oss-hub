import { Consent as PrismaConsent, Prisma } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ConsentsRepository } from './consents.repository';

// 합성 데이터만 사용한다 (docs/rules/security.md)
const syntheticUserId = 'cuid-synthetic-consent-user';
const syntheticVersion = 'privacy-activity-consent-v1';

function buildRow(overrides: Partial<PrismaConsent> = {}): PrismaConsent {
  return {
    id: 'cuid-synthetic-consent',
    userId: syntheticUserId,
    policyVersion: syntheticVersion,
    consentedAt: new Date('2026-07-19T01:00:00.000Z'),
    ...overrides,
  };
}

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'synthetic',
  });
}

describe('ConsentsRepository.createConsent', () => {
  it('생성 결과를 Prisma row가 아닌 도메인 필드만으로 반환한다', async () => {
    const create = jest.fn().mockResolvedValue(buildRow());
    const prisma = {
      consent: { create },
    } as unknown as PrismaService;

    const record = await new ConsentsRepository(prisma).createConsent(
      syntheticUserId,
      syntheticVersion,
    );

    expect(record).toEqual({
      policyVersion: syntheticVersion,
      consentedAt: new Date('2026-07-19T01:00:00.000Z'),
    });
    expect(create).toHaveBeenCalledWith({
      data: { userId: syntheticUserId, policyVersion: syntheticVersion },
    });
  });

  it('unique 충돌(P2002)은 기존 행으로 수렴한다 — 중복 레코드를 만들지 않는다', async () => {
    const create = jest.fn().mockRejectedValue(uniqueViolation());
    const findUnique = jest.fn().mockResolvedValue(buildRow());
    const prisma = {
      consent: { create, findUnique },
    } as unknown as PrismaService;

    const record = await new ConsentsRepository(prisma).createConsent(
      syntheticUserId,
      syntheticVersion,
    );

    expect(record.policyVersion).toBe(syntheticVersion);
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        userId_policyVersion: {
          userId: syntheticUserId,
          policyVersion: syntheticVersion,
        },
      },
    });
  });

  it('같은 동의를 순차 재요청하면 기존 타임스탬프로 수렴한다', async () => {
    const existing = buildRow();
    const create = jest
      .fn()
      .mockResolvedValueOnce(existing)
      .mockRejectedValueOnce(uniqueViolation());
    const findUnique = jest.fn().mockResolvedValue(existing);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ConsentsRepository,
        {
          provide: PrismaService,
          useValue: { consent: { create, findUnique } },
        },
      ],
    }).compile();
    const repository = moduleRef.get(ConsentsRepository);

    const first = await repository.createConsent(
      syntheticUserId,
      syntheticVersion,
    );
    const second = await repository.createConsent(
      syntheticUserId,
      syntheticVersion,
    );
    await moduleRef.close();

    expect(first).toEqual(second);
    expect(second.consentedAt).toEqual(existing.consentedAt);
    expect(create).toHaveBeenCalledTimes(2);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('P2002 외의 오류는 그대로 던진다', async () => {
    const create = jest.fn().mockRejectedValue(new Error('connection lost'));
    const prisma = {
      consent: { create },
    } as unknown as PrismaService;

    await expect(
      new ConsentsRepository(prisma).createConsent(
        syntheticUserId,
        syntheticVersion,
      ),
    ).rejects.toThrow('connection lost');
  });
});
