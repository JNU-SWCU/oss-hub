import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { HealthRepository } from './health.repository';

@Injectable()
export class HealthService {
  constructor(private readonly repository: HealthRepository) {}

  async assertDatabaseReachable(): Promise<void> {
    if (!(await this.isDatabaseReachable())) {
      throw new ServiceUnavailableException();
    }
  }

  async isDatabaseReachable(): Promise<boolean> {
    try {
      await this.repository.checkDatabaseConnection();
      return true;
    } catch {
      return false;
    }
  }
}
