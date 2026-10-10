import type { InvitationCandidateRecord } from '../domain/team-invitation';

export class InvitationCandidateResponseDto {
  id: string;
  nickname: string;
  name: string | null;
  avatarUrl: string | null;

  private constructor(record: InvitationCandidateRecord) {
    this.id = record.id;
    this.nickname = record.nickname;
    this.name = record.name;
    this.avatarUrl = record.avatarUrl;
  }

  static from(
    record: InvitationCandidateRecord,
  ): InvitationCandidateResponseDto {
    return new InvitationCandidateResponseDto(record);
  }
}
