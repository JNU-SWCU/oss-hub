import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  completeCompatibleProfileIfUnchanged,
  updateCompatibleProfileFields,
} from '../profiles/profile-compatibility.repository';
import {
  COMPATIBLE_PROFILE_SELECT,
  resolveCompatibleProfile,
} from '../profiles/profile-compatibility';
import type {
  CompleteUserProfileInput,
  UpdateProfileFieldsInput,
  UserProfileRecord,
} from './domain/user-profile';

export interface UsersRepositoryPort {
  findByGithubId(githubId: bigint): Promise<UserProfileRecord | null>;
  completeProfileIfUnchanged(
    expected: UserProfileRecord,
    input: CompleteUserProfileInput,
  ): Promise<boolean>;
  updateProfileFields(
    userId: string,
    fields: UpdateProfileFieldsInput,
  ): Promise<void>;
}

@Injectable()
export class UsersRepository implements UsersRepositoryPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findByGithubId(githubId: bigint): Promise<UserProfileRecord | null> {
    const user = await this.prisma.user.findUnique({
      where: { githubId },
      select: {
        id: true,
        ...COMPATIBLE_PROFILE_SELECT,
      },
    });
    return user ? { id: user.id, ...resolveCompatibleProfile(user) } : null;
  }

  async completeProfileIfUnchanged(
    expected: UserProfileRecord,
    input: CompleteUserProfileInput,
  ): Promise<boolean> {
    try {
      return await this.prisma.$transaction((transaction) =>
        completeCompatibleProfileIfUnchanged(transaction, expected, input),
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return false;
      }
      throw error;
    }
  }

  async updateProfileFields(
    userId: string,
    fields: UpdateProfileFieldsInput,
  ): Promise<void> {
    await this.prisma.$transaction((transaction) =>
      updateCompatibleProfileFields(transaction, userId, fields),
    );
  }
}
