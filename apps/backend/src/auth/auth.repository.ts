import { Injectable } from '@nestjs/common';
import { User as PrismaUser } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser, GithubProfile } from './domain/auth-user';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  // role은 update/create 어느 쪽에서도 건드리지 않는다 — 기존 role은 로그인마다 유지된다.
  async upsertUser(profile: GithubProfile): Promise<AuthUser> {
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
      },
    });
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
      role: user.role,
    };
  }
}
