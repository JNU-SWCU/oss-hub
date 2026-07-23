import { Injectable } from '@nestjs/common';
import { AccountStatus } from '@prisma/client';
import type { Prisma, User as PrismaUser } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveBootstrapRole } from './admin-bootstrap';
import type {
  AuthLoginResult,
  AuthUser,
  GithubProfile,
} from './domain/auth-user';

export interface AuthTransactionStore {
  upsertUser(profile: GithubProfile): Promise<AuthLoginResult>;
}

class PrismaAuthTransactionStore implements AuthTransactionStore {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  /**
   * 기존 사용자는 login·avatarUrl만 갱신한다 — 온보딩 name과 권한 상태는 로그인마다 유지된다.
   * 초기 관리자 부트스트랩(Issue #109)만 예외로, role이 아직 null인 계정이 부트스트랩 대상 login과
   * 일치하면 이 시점에 ADMIN으로 승격한다.
   *
   * name은 update 절에서 제외한다. 온보딩 프로필(#220)에서 사용자가 직접 확정한 값을
   * GitHub 프로필 재로그인이 덮어쓰면 완료된 온보딩 상태가 되돌아가기 때문이다.
   */
  async upsertUser(profile: GithubProfile): Promise<AuthLoginResult> {
    const bootstrapRole = resolveBootstrapRole(profile.login);
    const created = await this.transaction.user.createMany({
      data: {
        githubId: profile.githubId,
        login: profile.login,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        role: bootstrapRole ?? undefined,
      },
      skipDuplicates: true,
    });
    let user =
      created.count === 1
        ? await this.transaction.user.findUniqueOrThrow({
            where: { githubId: profile.githubId },
          })
        : await this.transaction.user.update({
            where: { githubId: profile.githubId },
            data: {
              login: profile.login,
              avatarUrl: profile.avatarUrl,
            },
          });
    if (
      user.accountStatus === AccountStatus.ACTIVE &&
      user.role === null &&
      bootstrapRole
    ) {
      user = await this.transaction.user.update({
        where: { id: user.id },
        data: { role: bootstrapRole },
      });
    }
    return { user: toDomain(user), isNew: created.count === 1 };
  }
}

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  withTransaction<T>(
    operation: (store: AuthTransactionStore) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction((transaction) =>
      operation(new PrismaAuthTransactionStore(transaction)),
    );
  }

  async findByGithubId(githubId: bigint): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({ where: { githubId } });
    return user ? toDomain(user) : null;
  }
}

function toDomain(user: PrismaUser): AuthUser {
  return {
    id: user.id,
    githubId: user.githubId,
    login: user.login,
    name: user.name,
    avatarUrl: user.avatarUrl,
    accountStatus: user.accountStatus,
    role: user.role,
  };
}
