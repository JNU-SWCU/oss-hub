import { InvitationCandidateRecord } from '../team-invitations.repository';

/**
 * 초대 대상 검색 결과 항목. 공개해도 되는 필드만 노출한다 — 학번·이메일·연락처는
 * 절대 포함하지 않는다(AGENTS.md 개인정보 경계).
 */
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
