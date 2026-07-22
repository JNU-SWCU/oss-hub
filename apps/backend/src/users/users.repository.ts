import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CompleteUserProfileInput,
  UserProfileRecord,
} from './domain/user-profile';

export interface UsersRepositoryPort {
  findByGithubId(githubId: bigint): Promise<UserProfileRecord | null>;
  completeProfileIfIncomplete(
    userId: string,
    input: CompleteUserProfileInput,
  ): Promise<boolean>;
}

@Injectable()
export class UsersRepository implements UsersRepositoryPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findByGithubId(githubId: bigint): Promise<UserProfileRecord | null> {
    return this.prisma.user.findUnique({
      where: { githubId },
      select: {
        id: true,
        name: true,
        studentId: true,
        department: true,
      },
    });
  }

  async completeProfileIfIncomplete(
    userId: string,
    input: CompleteUserProfileInput,
  ): Promise<boolean> {
    const result = await this.prisma.user.updateMany({
      where: {
        id: userId,
        OR: [{ name: null }, { studentId: null }, { department: null }],
      },
      data: input,
    });
    return result.count === 1;
  }
}
