import type { StudentRepositoryUrlView } from '../programs.types';

export class StudentRepositoryUrlResponseDto {
  declare readonly repositoryUrl: string | null;
  declare readonly canEditRepositoryUrl: boolean;

  static from(view: StudentRepositoryUrlView): StudentRepositoryUrlResponseDto {
    return {
      repositoryUrl: view.repositoryUrl,
      canEditRepositoryUrl: view.canEditRepositoryUrl,
    };
  }
}
