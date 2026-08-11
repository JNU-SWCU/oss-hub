import { IsArray, IsNotEmpty, IsString } from 'class-validator';

/**
 * `PATCH /milestones/:milestoneId/documents/order` 요청 본문 — 이 마일스톤의 서류 **전체**를
 * 원하는 순서로 나열한다. 부분 목록을 받지 않는 것이 이 endpoint의 핵심이다: 두 항목을 각각
 * PATCH하다 한쪽만 성공하면 sortOrder가 같은 두 항목이 남고, 그러면 다음 「위로」가 조용히
 * 아무 일도 하지 않는다(같은 값끼리 맞바꿔도 순서가 그대로다).
 *
 * 전체 집합 일치 검증은 서비스가 한다 — 이 DTO는 모양(문자열 배열)만 본다.
 */
export class ReorderMilestoneDocumentsRequestDto {
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  declare readonly documentIds: string[];
}
