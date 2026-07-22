import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CompleteUserProfileInput,
  UserProfileRecord,
} from './domain/user-profile';

export interface UsersRepositoryPort {
  findByGithubId(githubId: bigint): Promise<UserProfileRecord | null>;
  completeProfileIfUnchanged(
    expected: UserProfileRecord,
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

  async completeProfileIfUnchanged(
    expected: UserProfileRecord,
    input: CompleteUserProfileInput,
  ): Promise<boolean> {
    const result = await this.prisma.user.updateMany({
      where: {
        id: expected.id,
        name: expected.name,
        studentId: expected.studentId,
        department: expected.department,
      },
      data: input,
    });
    return result.count === 1;
  }
}
