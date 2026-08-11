import { TeamInvitationStatus } from '@prisma/client';
import { ReceivedTeamInvitationRecord } from '../team-invitations.repository';

/**
 * `GET /team-invitations/received` 응답 목록 항목 하나.
 *
 * `TeamInvitationResponseDto`(초대 발송·취소 응답)의 필드를 모두 포함하고 팀·프로그램
 * 요약을 더한다 — 이미 이 경로를 쓰던 팀 화면은 늘어난 필드를 무시하므로 그대로 돈다.
 * 요약이 필요한 이유는 `ReceivedTeamInvitationRecord` 주석에 있다.
 */
export class ReceivedTeamInvitationResponseDto {
  id: string;
  teamId: string;
  programId: string;
  invitedById: string;
  status: TeamInvitationStatus;
  invitedAt: string;
  respondedAt: string | null;
  teamName: string;
  programName: string;
  invitedByDisplayName: string;
  memberCount: number;
  teamMaxSize: number;

  private constructor(record: ReceivedTeamInvitationRecord) {
    this.id = record.id;
    this.teamId = record.teamId;
    this.programId = record.programId;
    this.invitedById = record.invitedById;
    this.status = record.status;
    this.invitedAt = record.invitedAt.toISOString();
    this.respondedAt = record.respondedAt?.toISOString() ?? null;
    this.teamName = record.teamName;
    this.programName = record.programName;
    this.invitedByDisplayName = record.invitedByDisplayName;
    this.memberCount = record.memberCount;
    this.teamMaxSize = record.teamMaxSize;
  }

  static from(
    record: ReceivedTeamInvitationRecord,
  ): ReceivedTeamInvitationResponseDto {
    return new ReceivedTeamInvitationResponseDto(record);
  }
}
