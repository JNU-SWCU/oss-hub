import { IsBoolean } from 'class-validator';

/** `PATCH /programs/:programId/board/posts/:postId/pin` 요청 본문 — 교직원 전용. */
export class SetBoardPostPinnedRequestDto {
  @IsBoolean()
  declare readonly pinned: boolean;
}
