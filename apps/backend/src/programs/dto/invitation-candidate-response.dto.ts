import type {
  InvitationCandidatePage,
  InvitationCandidateRecord,
} from '../team-invitations.repository';

export class InvitationCandidateResponseDto {
  declare readonly id: string;
  declare readonly nickname: string;
  declare readonly name: string | null;

  static from(
    record: InvitationCandidateRecord,
  ): InvitationCandidateResponseDto {
    return {
      id: record.id,
      nickname: record.nickname,
      name: record.name,
    };
  }
}

export class InvitationCandidatePageResponseDto {
  declare readonly items: InvitationCandidateResponseDto[];
  declare readonly hasMore: boolean;

  static from(
    page: InvitationCandidatePage,
  ): InvitationCandidatePageResponseDto {
    return {
      items: page.items.map((record) =>
        InvitationCandidateResponseDto.from(record),
      ),
      hasMore: page.hasMore,
    };
  }
}
