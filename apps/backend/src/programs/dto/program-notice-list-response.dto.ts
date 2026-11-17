import type { ProgramNoticeList } from '../program-notice.types';

class ProgramNoticeListItemResponseDto {
  declare readonly url: string;
  declare readonly title: string;
  declare readonly postedAt: string;
  declare readonly thumbnailUrl: string | null;

  static from(
    item: ProgramNoticeList['items'][number],
  ): ProgramNoticeListItemResponseDto {
    return {
      url: item.url,
      title: item.title,
      postedAt: item.postedAt,
      thumbnailUrl: item.thumbnailUrl,
    };
  }
}

export class ProgramNoticeListResponseDto implements ProgramNoticeList {
  declare readonly items: ProgramNoticeListItemResponseDto[];

  static from(list: ProgramNoticeList): ProgramNoticeListResponseDto {
    return {
      items: list.items.map((item) =>
        ProgramNoticeListItemResponseDto.from(item),
      ),
    };
  }
}
