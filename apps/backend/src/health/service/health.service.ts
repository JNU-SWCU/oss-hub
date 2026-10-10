import { Injectable } from '@nestjs/common';
import { HealthRepository } from '../repository/health.repository';

@Injectable()
export class HealthService {
  constructor(private readonly repository: HealthRepository) {}

  async isDatabaseReachable(): Promise<boolean> {
    try {
      await this.repository.checkDatabaseConnection();
      return true;
    } catch {
      return false;
    }
  }
}
