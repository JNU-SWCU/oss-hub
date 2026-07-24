import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface NotificationSettings {
  readonly notificationEmail: string | null;
  readonly notifyEnabled: boolean;
}

export interface UpdateNotificationSettings {
  readonly notificationEmail: string;
  readonly notifyEnabled: boolean;
}

export interface NotificationSettingsRepositoryPort {
  findByGithubId(githubId: bigint): Promise<NotificationSettings | null>;
  updateByGithubId(
    githubId: bigint,
    settings: UpdateNotificationSettings,
  ): Promise<NotificationSettings | null>;
}

@Injectable()
export class NotificationSettingsRepository implements NotificationSettingsRepositoryPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findByGithubId(githubId: bigint): Promise<NotificationSettings | null> {
    return this.prisma.user.findUnique({
      where: { githubId },
      select: { notificationEmail: true, notifyEnabled: true },
    });
  }

  async updateByGithubId(
    githubId: bigint,
    settings: UpdateNotificationSettings,
  ): Promise<NotificationSettings | null> {
    const updated = await this.prisma.user.updateMany({
      where: { githubId },
      data: {
        notificationEmail: settings.notificationEmail,
        notifyEnabled: settings.notifyEnabled,
      },
    });
    if (updated.count !== 1) {
      return null;
    }
    return this.prisma.user.findUnique({
      where: { githubId },
      select: { notificationEmail: true, notifyEnabled: true },
    });
  }
}
