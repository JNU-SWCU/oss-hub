import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * `POST /programs/:programId/board/posts` 요청 본문. 글 종류(공지/질문)는
 * 여기서 받지 않는다 — 작성자 역할이 그대로 category를 결정한다(프로토타입 계약).
 */
export class CreateBoardPostRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  declare readonly title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  declare readonly body: string;
}
