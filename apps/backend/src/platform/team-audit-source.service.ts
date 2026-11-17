import { Injectable } from '@nestjs/common';
import { AuditSourceAdapterService } from './audit-source-adapter.service';
import type {
  AuditEntry,
  AuditMetadataEvidence,
  AuditSourceRow,
  AuditTeamMembership,
} from './audit-entry.types';

const TEAM_MEMBERSHIP_OPERATIONS: readonly unknown[] = [
  'LEAVE',
  'REMOVE',
  'TRANSFER_LEADER',
] satisfies readonly AuditTeamMembership['operation'][];

@Injectable()
export class TeamAuditSourceService extends AuditSourceAdapterService {
  toAuditEntry(row: AuditSourceRow): AuditEntry {
    const metadata = this.storedMetadata(row);
    return this.entry(row, metadata, {
      teamMembership: this.teamMembership(row.action, metadata),
    });
  }

  private teamMembership(
    action: string,
    metadata: AuditMetadataEvidence | null,
  ): AuditTeamMembership | null {
    if (action !== 'TEAM_MEMBERSHIP_CHANGED' || metadata === null) return null;
    const { operation, nextLeaderId } = metadata;
    const previousLeaderId = this.nonEmptyString(metadata.previousLeaderId);
    if (
      !this.isTeamMembershipOperation(operation) ||
      previousLeaderId === null ||
      !(nextLeaderId === null || this.nonEmptyString(nextLeaderId) !== null)
    )
      return null;
    return {
      operation,
      leaderChanged: nextLeaderId !== null && nextLeaderId !== previousLeaderId,
      teamDeleted: nextLeaderId === null,
    };
  }

  private isTeamMembershipOperation(
    value: unknown,
  ): value is AuditTeamMembership['operation'] {
    return TEAM_MEMBERSHIP_OPERATIONS.includes(value);
  }
}
