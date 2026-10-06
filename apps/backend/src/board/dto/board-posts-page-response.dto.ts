import { BoardPostsPageResult } from '../board.service';
import { BoardPostResponseDto } from './board-post-response.dto';

export class BoardPostsPageResponseDto {
  items: BoardPostResponseDto[];
  total: number;
  page: number;
  limit: number;

  private constructor(page: BoardPostsPageResult) {
    this.items = page.items.map((item) => BoardPostResponseDto.from(item));
    this.total = page.total;
    this.page = page.page;
    this.limit = page.limit;
  }

  static from(page: BoardPostsPageResult): BoardPostsPageResponseDto {
    return new BoardPostsPageResponseDto(page);
  }
}
