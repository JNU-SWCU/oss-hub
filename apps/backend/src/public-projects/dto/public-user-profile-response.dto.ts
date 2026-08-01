import type { PublicUserProfileResult } from '../public-project-result';
import { PublicProjectListItemResponseDto } from './public-project-response.dto';

export class PublicUserProfileResponseDto {
  readonly userId: string;
  readonly githubNickname: string;
  readonly avatarUrl: string | null;
  readonly projects: PublicProjectListItemResponseDto[];

  private constructor(result: PublicUserProfileResult) {
    this.userId = result.identity.userId;
    this.githubNickname = result.identity.githubNickname;
    this.avatarUrl = result.identity.avatarUrl;
    this.projects = result.projects.map((row) =>
      PublicProjectListItemResponseDto.from(row),
    );
  }

  static from(result: PublicUserProfileResult): PublicUserProfileResponseDto {
    return new PublicUserProfileResponseDto(result);
  }
}
