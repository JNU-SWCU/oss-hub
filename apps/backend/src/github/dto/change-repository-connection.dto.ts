import { RepositoryConnectionMode } from '@prisma/client';
import { IsDefined, IsEnum, Validate } from 'class-validator';
import { RepositoryConnectionTargetConstraint } from '../repository-connection-target.validator';

export class ChangeRepositoryConnectionRequestDto {
  @IsDefined()
  @IsEnum(RepositoryConnectionMode)
  declare readonly mode: RepositoryConnectionMode;

  @Validate(RepositoryConnectionTargetConstraint)
  declare readonly url?: string | null;
}

export type RepositoryConnectionResultResponseDto = {
  readonly status: 'CONNECTED' | 'PENDING';
  readonly applicationId: string;
  readonly repositoryId: string | null;
  /** 응답 시점에 실제로 연결된 current tuple. */
  readonly connectionMode: RepositoryConnectionMode;
  readonly repositoryUrl: string | null;
};

export class ChangeRepositoryConnectionResponseDto {
  readonly status: 'CONNECTED' | 'PENDING';
  readonly applicationId: string;
  readonly repositoryId: string | null;
  readonly connectionMode: RepositoryConnectionMode;
  readonly repositoryUrl: string | null;

  private constructor(result: RepositoryConnectionResultResponseDto) {
    this.status = result.status;
    this.applicationId = result.applicationId;
    this.repositoryId = result.repositoryId;
    this.connectionMode = result.connectionMode;
    this.repositoryUrl = result.repositoryUrl;
  }

  static from(
    result: RepositoryConnectionResultResponseDto,
  ): ChangeRepositoryConnectionResponseDto {
    return new ChangeRepositoryConnectionResponseDto(result);
  }
}
