import { Injectable } from '@nestjs/common';
import {
  LOGIN_HISTORY_EVENTS,
  type LoginHistoryPage,
} from './domain/login-history';
import { LoginHistoryStore } from './login-history.store';

@Injectable()
export class LoginHistoryService {
  constructor(private readonly repository: LoginHistoryStore) {}

  async recordLogin(userId: string): Promise<void> {
    await this.repository.create(userId, LOGIN_HISTORY_EVENTS.LOGIN);
  }

  async recordLogout(userId: string): Promise<void> {
    await this.repository.create(userId, LOGIN_HISTORY_EVENTS.LOGOUT);
  }

  async findMine(
    userId: string,
    page: number,
    size: number,
  ): Promise<LoginHistoryPage> {
    return this.repository.findPage(userId, page, size);
  }
}
