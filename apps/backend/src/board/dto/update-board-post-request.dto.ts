import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** `PATCH /programs/:programId/board/posts/:postId` 요청 본문 — 작성자 본인만. */
export class UpdateBoardPostRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  declare readonly title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  declare readonly body: string;
}
