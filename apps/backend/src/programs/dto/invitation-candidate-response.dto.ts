import type { InvitationCandidateRecord } from '../team-invitations.repository';

export class InvitationCandidateResponseDto {
  declare readonly id: string;
  declare readonly nickname: string;
  declare readonly name: string | null;
  declare readonly avatarUrl: string | null;

  static from(
    record: InvitationCandidateRecord,
  ): InvitationCandidateResponseDto {
    return {
      id: record.id,
      nickname: record.nickname,
      name: record.name,
      avatarUrl: record.avatarUrl,
    };
  }
}
