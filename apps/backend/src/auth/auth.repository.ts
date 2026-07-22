import { Injectable } from '@nestjs/common';
import { AccountStatus, User as PrismaUser } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveBootstrapRole } from './admin-bootstrap';
import { AuthUser, GithubProfile } from './domain/auth-user';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * role은 upsert의 update/create 어느 쪽에서도 무조건 덮어쓰지 않는다 — 기존 role은 로그인마다 유지된다.
   * 초기 관리자 부트스트랩(Issue #109)만 예외로, role이 아직 null인 계정이 부트스트랩 대상 login과
   * 일치하면 이 시점에 ADMIN으로 승격한다.
   */
  async upsertUser(profile: GithubProfile): Promise<AuthUser> {
    const bootstrapRole = resolveBootstrapRole(profile.login);
    const user = await this.prisma.user.upsert({
      where: { githubId: profile.githubId },
      update: {
        login: profile.login,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
      },
      create: {
        githubId: profile.githubId,
        login: profile.login,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        role: bootstrapRole ?? undefined,
      },
    });
    if (
      user.accountStatus === AccountStatus.ACTIVE &&
      user.role === null &&
      bootstrapRole
    ) {
      const promoted = await this.prisma.user.update({
        where: { id: user.id },
        data: { role: bootstrapRole },
      });
      return this.toDomain(promoted);
    }
    return this.toDomain(user);
  }

  async findByGithubId(githubId: bigint): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({ where: { githubId } });
    return user ? this.toDomain(user) : null;
  }

  private toDomain(user: PrismaUser): AuthUser {
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
}
