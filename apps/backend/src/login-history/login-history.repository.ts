import { Injectable } from '@nestjs/common';
import type { LoginHistory as PrismaLoginHistory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  LOGIN_HISTORY_PROVIDER,
  type LoginHistory,
  type LoginHistoryEvent,
  type LoginHistoryPage,
} from './domain/login-history';

@Injectable()
export class LoginHistoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, event: LoginHistoryEvent): Promise<void> {
    await this.prisma.loginHistory.create({
      data: {
        userId,
        event,
        provider: LOGIN_HISTORY_PROVIDER,
        success: true,
      },
    });
  }

  async findPage(
    userId: string,
    page: number,
    size: number,
  ): Promise<LoginHistoryPage> {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.loginHistory.findMany({
        where: { userId },
        orderBy: { loginAt: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
      this.prisma.loginHistory.count({ where: { userId } }),
    ]);
    return {
      items: rows.map((row) => this.toDomain(row)),
      page,
      size,
      total,
    };
  }

  private toDomain(row: PrismaLoginHistory): LoginHistory {
    return {
      id: row.id,
      event: row.event,
      provider: LOGIN_HISTORY_PROVIDER,
      success: row.success,
      loginAt: row.loginAt,
    };
  }
}
