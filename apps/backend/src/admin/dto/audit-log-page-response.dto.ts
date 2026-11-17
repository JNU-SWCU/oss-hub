import { ApiProperty } from '@nestjs/swagger';
import type { AuditLogPage } from '../../platform/audit-log-read.service';
import type {
  AuditCategoryCounts,
  AuditChange,
  AuditEntry,
  AuditTarget,
  AuditTeamMembership,
} from '../../platform/audit-entry.types';
import {
  AUDIT_CATEGORIES,
  type AuditCategory,
} from '../../platform/audit-source.config';

class AuditPersonResponseDto {
  declare readonly id: string | null;
  declare readonly name: string | null;
  declare readonly login: string | null;
  declare readonly role: string | null;

  static from(
    person: NonNullable<AuditEntry['actor']>,
  ): AuditPersonResponseDto {
    return {
      id: person.id,
      name: person.name,
      login: person.login,
      role: person.role,
    };
  }
}

class AuditTargetResponseDto {
  declare readonly type: string;
  declare readonly id: string;
  declare readonly name: string | null;
  declare readonly login: string | null;
  declare readonly role: string | null;
  declare readonly programName: string | null;
  declare readonly teamName: string | null;

  static from(target: AuditTarget): AuditTargetResponseDto {
    return {
      type: target.type,
      id: target.id,
      name: target.name,
      login: target.login,
      role: target.role,
      programName: target.programName,
      teamName: target.teamName,
    };
  }
}

class AuditChangeResponseDto {
  declare readonly field: string;
  @ApiProperty({
    oneOf: [
      { type: 'string', nullable: true },
      { type: 'number' },
      { type: 'boolean' },
    ],
  })
  declare readonly before: string | number | boolean | null;
  @ApiProperty({
    oneOf: [
      { type: 'string', nullable: true },
      { type: 'number' },
      { type: 'boolean' },
    ],
  })
  declare readonly after: string | number | boolean | null;

  static from(change: AuditChange): AuditChangeResponseDto {
    return {
      field: change.field,
      before: change.before,
      after: change.after,
    };
  }
}

class AuditTeamMembershipResponseDto {
  declare readonly operation: 'LEAVE' | 'REMOVE' | 'TRANSFER_LEADER';
  declare readonly leaderChanged: boolean;
  declare readonly teamDeleted: boolean;

  static from(membership: AuditTeamMembership): AuditTeamMembershipResponseDto {
    return {
      operation: membership.operation,
      leaderChanged: membership.leaderChanged,
      teamDeleted: membership.teamDeleted,
    };
  }
}

class AuditCategoryCountsResponseDto {
  declare readonly ACCOUNT: number;
  declare readonly OPERATION: number;
  declare readonly SUBMISSION: number;
  declare readonly LOGIN: number;
  declare readonly SYSTEM: number;

  static from(counts: AuditCategoryCounts): AuditCategoryCountsResponseDto {
    return {
      ACCOUNT: counts.ACCOUNT,
      OPERATION: counts.OPERATION,
      SUBMISSION: counts.SUBMISSION,
      LOGIN: counts.LOGIN,
      SYSTEM: counts.SYSTEM,
    };
  }
}

class AuditLogRecordResponseDto {
  declare readonly id: string;
  declare readonly actor: AuditPersonResponseDto | null;
  declare readonly action: string;
  @ApiProperty({ enum: AUDIT_CATEGORIES })
  declare readonly category: AuditCategory;
  declare readonly target: AuditTargetResponseDto;
  declare readonly change: AuditChangeResponseDto | null;
  declare readonly requestId: string | null;
  declare readonly teamMembership: AuditTeamMembershipResponseDto | null;
  declare readonly occurredAt: string;
  declare readonly legacy: boolean;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  declare readonly metadata: Readonly<Record<string, unknown>> | null;

  static from(record: AuditEntry): AuditLogRecordResponseDto {
    return {
      id: record.id,
      occurredAt: record.occurredAt.toISOString(),
      action: record.action,
      category: record.category,
      actor:
        record.actor === null
          ? null
          : AuditPersonResponseDto.from(record.actor),
      target: AuditTargetResponseDto.from(record.target),
      change:
        record.change === null
          ? null
          : AuditChangeResponseDto.from(record.change),
      requestId: record.requestId,
      teamMembership:
        record.teamMembership === null
          ? null
          : AuditTeamMembershipResponseDto.from(record.teamMembership),
      legacy: record.legacy,
      metadata: record.metadata,
    };
  }
}

export class AuditLogPageResponseDto {
  declare readonly items: AuditLogRecordResponseDto[];
  declare readonly total: number;
  declare readonly page: number;
  declare readonly limit: number;
  declare readonly counts: AuditCategoryCountsResponseDto;

  static from(page: AuditLogPage): AuditLogPageResponseDto {
    return {
      items: page.items.map((record) => AuditLogRecordResponseDto.from(record)),
      total: page.total,
      page: page.page,
      limit: page.limit,
      counts: AuditCategoryCountsResponseDto.from(page.counts),
    };
  }
}
