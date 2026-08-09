import { IsNotEmpty, IsString } from 'class-validator';

/** `POST /admin/collection/discover-external` 요청 본문 — 대상 학생의 GitHub login 하나. */
export class CollectionExternalDiscoveryRequestDto {
  @IsString()
  @IsNotEmpty()
  githubLogin!: string;
}
