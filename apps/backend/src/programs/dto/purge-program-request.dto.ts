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
 * ADMIN이 화면에서 확인한(그리고 재확인 다이얼로그에서 다시 읽은) 삭제 범위 스냅샷.
 * `program-deletion-scope.ts`의 `ProgramDeletionScopeCounts`와 필드가 정확히 같아야
 * purge 트랜잭션 내부 비교가 뜻대로 동작한다.
 */
export class PurgeProgramExpectedScopeRequestDto {
  @IsInt()
  @Min(0)
  readonly applications!: number;

  @IsInt()
  @Min(0)
  readonly teams!: number;

  @IsInt()
  @Min(0)
  readonly boardPosts!: number;

  @IsInt()
  @Min(0)
  readonly submissions!: number;

  @IsInt()
  @Min(0)
  readonly submissionEvents!: number;

  @IsString()
  @Matches(/^[0-9a-f]{32}$/)
  readonly scopeFingerprint!: string;
}

/**
 * DELETE /programs/:id/purge 요청 본문 — REQUIRED(fail closed).
 *
 * purge는 ADMIN 전용이고 오직 위험 영역 UI 한 곳만 호출한다(#F2). 다른 클라이언트가
 * 이 계약에 기대는 경우가 없으므로, expectedScope를 optional로 열어 구버전 호출을
 * 허용할 이유가 없다 — optional로 두면 검증을 우회하는 요청을 그대로 통과시켜
 * TOCTOU를 재도입하게 된다. 그래서 항상 필수로 받고 없으면 400으로 거절한다.
 */
export class PurgeProgramRequestDto {
  // @ValidateNested()만 쓰면 expectedScope 자체가 아예 없거나(`{}`) null이어도
  // class-validator가 "검증할 값이 없음"으로 보고 통과시켜버렸다 — 그 결과 컨트롤러가
  // `body.expectedScope`를 undefined로 받아 비교 로직에서 TypeError(500)로 터졌다.
  // @IsDefined()가 undefined/null을, @IsNotEmptyObject()가 `{}`와 객체가 아닌 값을
  // 명시적으로 거부해 이 경우도 다른 명시적 400과 같은 problem-detail로 수렴된다.
  @IsDefined()
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => PurgeProgramExpectedScopeRequestDto)
  readonly expectedScope!: PurgeProgramExpectedScopeRequestDto;
}
