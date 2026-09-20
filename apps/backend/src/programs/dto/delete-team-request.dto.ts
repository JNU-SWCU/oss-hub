import { Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsNotEmptyObject,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * 교직원이 삭제 확인 창에서 확인한 팀 범위 스냅샷.
 * `team-deletion-scope.ts`의 `TeamDeletionScopeCounts`와 필드가 정확히 같아야
 * 삭제 트랜잭션 내부 비교가 뜻대로 동작한다.
 */
export class DeleteTeamExpectedScopeRequestDto {
  @IsInt()
  @Min(0)
  readonly applications!: number;

  @IsInt()
  @Min(0)
  readonly members!: number;

  @IsInt()
  @Min(0)
  readonly invitations!: number;

  @IsInt()
  @Min(0)
  readonly submissions!: number;

  @IsInt()
  @Min(0)
  readonly submissionEvents!: number;

  @IsInt()
  @Min(0)
  readonly detachedRepositories!: number;

  @IsString()
  @Matches(/^[0-9a-f]{32}$/)
  readonly scopeFingerprint!: string;
}

/**
 * DELETE /programs/:programId/teams/:teamId 요청 본문 — REQUIRED(fail closed).
 *
 * program purge의 `PurgeProgramRequestDto`와 같은 이유로 optional을 열지 않는다 —
 * optional로 두면 검증을 우회하는 요청이 그대로 통과해 TOCTOU가 되살아난다.
 * `@ValidateNested()`만으로는 `expectedScope` 자체가 없거나 `{}`·null이어도
 * "검증할 값이 없음"으로 통과하므로 `@IsDefined()`/`@IsNotEmptyObject()`로 막는다.
 */
export class DeleteTeamRequestDto {
  @IsDefined()
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => DeleteTeamExpectedScopeRequestDto)
  readonly expectedScope!: DeleteTeamExpectedScopeRequestDto;
}
