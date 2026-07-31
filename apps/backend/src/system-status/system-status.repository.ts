import { Injectable } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface SystemStatusActor {
  role: Role | null;
  accountStatus: AccountStatus;
}

@Injectable()
export class SystemStatusRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActor(githubId: bigint): Promise<SystemStatusActor | null> {
    return this.prisma.user.findUnique({
      where: { githubId },
      select: { role: true, accountStatus: true },
    });
  }
}
