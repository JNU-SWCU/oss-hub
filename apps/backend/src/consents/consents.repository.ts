import { Injectable } from '@nestjs/common';
import { Consent as PrismaConsent, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConsentRecord, ConsentUser } from './domain/consent';

@Injectable()
export class ConsentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findUserByGithubId(githubId: bigint): Promise<ConsentUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { githubId },
      select: { id: true, accountStatus: true },
    });
    return user ? { id: user.id, accountStatus: user.accountStatus } : null;
  }

  async findConsent(
    userId: string,
    policyVersion: string,
  ): Promise<ConsentRecord | null> {
    const consent = await this.prisma.consent.findUnique({
      where: { userId_policyVersion: { userId, policyVersion } },
    });
    return consent ? this.toDomain(consent) : null;
  }

  /**
   * Consent는 append-only다(schema 계약) — UPDATE/DELETE를 수행하지 않는다.
   * 같은 (userId, policyVersion) 재요청은 unique 충돌(P2002)을 기존 행으로
   * 수렴시켜 중복 레코드를 만들지 않는다(티켓 데이터 규칙).
   */
  async createConsent(
    userId: string,
    policyVersion: string,
  ): Promise<ConsentRecord> {
    try {
      const created = await this.prisma.consent.create({
        data: { userId, policyVersion },
      });
      return this.toDomain(created);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.findConsent(userId, policyVersion);
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  private toDomain(consent: PrismaConsent): ConsentRecord {
    return {
      policyVersion: consent.policyVersion,
      consentedAt: consent.consentedAt,
    };
  }
}
