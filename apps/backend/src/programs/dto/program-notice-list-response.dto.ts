import type { ProgramNoticeList } from '../program-notice.types';

export class ProgramNoticeListResponseDto implements ProgramNoticeList {
  declare readonly items: ProgramNoticeList['items'];

  static from(list: ProgramNoticeList): ProgramNoticeListResponseDto {
    return { items: list.items };
  }
}
