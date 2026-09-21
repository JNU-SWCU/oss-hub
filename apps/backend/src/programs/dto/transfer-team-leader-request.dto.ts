import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * 교직원의 팀장 변경 요청 본문.
 *
 * `userId`는 내부 사용자 식별자이며, 그 사람이 대상 팀의 현재 구성원인지는 여기서
 * 판정하지 않는다 — 팀 행을 잠근 뒤 repository가 본다. 형식만 거르고 사실 판정은
 * 잠금 안으로 미루는 것이 이 저장소의 규칙이다.
 */
export class TransferTeamLeaderRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  readonly userId!: string;
}
