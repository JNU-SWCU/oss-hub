import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength } from 'class-validator';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * 팀 이름 변경 본문. 상한(`MaxLength(100)`)은 `CreateTeamRequestDto`와 같은 값이어야
 * 한다 — 만들 때 통과한 이름을 바꿀 때 거절하거나 그 반대가 되면 안 된다.
 *
 * 생성과 달리 trim을 DTO에서 먼저 한다. 생성 경로는 service가 나중에 trim해서
 * 공백만 있는 이름(`"   "`)이 `@IsNotEmpty()`를 통과한 뒤 빈 이름으로 저장되는데,
 * 같은 구멍을 새로 만들지 않는다(`@Matches(/\S/u)`는 같은 폴더의
 * `update-milestone-request.dto.ts`가 쓰는 방식이다).
 */
export class RenameTeamRequestDto {
  @Transform(({ value }: { readonly value: unknown }) => trimString(value))
  @IsString()
  @Matches(/\S/u)
  @MaxLength(100)
  declare readonly name: string;
}
