import { Injectable } from '@nestjs/common';
import { UserType } from '@prisma/client';
import { StaffAccessRequestStatus } from '../users/user-contract.config';
import {
  INDEPENDENT_AUTHORITY_AUDIT_ACTIONS,
  type HistoryAuditMetadataView,
} from './history-metadata.config';
import { InvalidAuditLogMetadataError } from './history.error';
import { AuditSourceAdapterService } from './audit-source-adapter.service';
import type {
  AuditEntry,
  AuditMetadataEvidence,
  AuditSourceRow,
} from './audit-entry.types';

@Injectable()
export class AccountAuditSourceService extends AuditSourceAdapterService {
  toAuditEntry(row: AuditSourceRow): AuditEntry {
    const metadata = this.recordMetadata(row);
    return this.entry(row, metadata, {
      requestId:
        metadata?.recordKind === 'REQUEST_TRANSITION' &&
        typeof metadata.requestId === 'string'
          ? metadata.requestId
          : null,
    });
  }

  private recordMetadata(row: AuditSourceRow): AuditMetadataEvidence | null {
    if (!row.historyKind) return this.storedMetadata(row);
    if (
      row.historyKind === 'BOOTSTRAP' &&
      row.action !== INDEPENDENT_AUTHORITY_AUDIT_ACTIONS.GRANT_ADMIN_ACCESS &&
      row.action !== INDEPENDENT_AUTHORITY_AUDIT_ACTIONS.REVOKE_ADMIN_ACCESS
    )
      throw new InvalidAuditLogMetadataError();
    const history = this.historyMetadata(row.metadata, row.historyKind);
    if (!history) throw new InvalidAuditLogMetadataError();
    return history;
  }

  private historyMetadata(
    value: unknown,
    recordKind: string,
  ): HistoryAuditMetadataView | null {
    if (
      !this.isObject(value) ||
      value.schemaVersion !== 1 ||
      value.recordKind !== recordKind
    )
      return null;
    switch (value.recordKind) {
      case 'SIGNUP':
      case 'BOOTSTRAP':
        return { schemaVersion: 1, recordKind: value.recordKind };
      case 'TYPE_SELECTION':
        if (!this.isUserType(value.before) || !this.isUserType(value.after))
          return null;
        return {
          schemaVersion: 1,
          recordKind: 'TYPE_SELECTION',
          before: value.before,
          after: value.after,
        };
      case 'REQUEST_TRANSITION': {
        const request = value.request;
        if (!this.isObject(request) || typeof request.id !== 'string')
          return null;
        const status = this.requestStatus(request.status);
        if (status === null) return null;
        if (
          value.cause !== undefined &&
          value.cause !== 'SUPERSEDED' &&
          value.cause !== 'TYPE_CHANGED' &&
          value.cause !== 'ADMIN_TYPE_CHANGE'
        )
          return null;
        if (
          value.replacementRequestId !== undefined &&
          value.replacementRequestId !== null &&
          typeof value.replacementRequestId !== 'string'
        )
          return null;
        return {
          schemaVersion: 1,
          recordKind: 'REQUEST_TRANSITION',
          requestId: request.id,
          status,
          ...(value.cause === undefined ? {} : { cause: value.cause }),
          ...(value.replacementRequestId === undefined
            ? {}
            : { replacementRequestId: value.replacementRequestId }),
        };
      }
      default:
        return null;
    }
  }

  private requestStatus(value: unknown): StaffAccessRequestStatus | null {
    switch (value) {
      case StaffAccessRequestStatus.PENDING:
      case StaffAccessRequestStatus.APPROVED:
      case StaffAccessRequestStatus.REJECTED:
      case StaffAccessRequestStatus.REVOKED:
        return value;
      default:
        return null;
    }
  }

  private isUserType(value: unknown): value is UserType {
    switch (value) {
      case UserType.UNSELECTED:
      case UserType.STUDENT:
      case UserType.STAFF:
        return true;
      default:
        return false;
    }
  }
}
