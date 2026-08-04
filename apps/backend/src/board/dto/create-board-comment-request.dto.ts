import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** `POST /programs/:programId/board/posts/:postId/comments` 요청 본문. */
export class CreateBoardCommentRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  declare readonly body: string;
}
