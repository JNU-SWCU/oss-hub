import { Injectable } from '@nestjs/common';
import { DomainException } from '../platform/error-code.error';
import { ApplicationsRepository } from './applications.repository';

@Injectable()
export class ApplicationPreparationsService {
  constructor(private readonly repository: ApplicationsRepository) {}

  async get(githubId: bigint): Promise<null> {
    const actor = await this.repository.findActiveStudentByGithubId(githubId);
    if (!actor)
      throw new DomainException({
        code: 'APP_008',
        status: 403,
        message: '활성 학생 계정으로 로그인해 주세요.',
      });
    return null;
  }
}
