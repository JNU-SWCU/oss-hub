import type { UserType } from '@prisma/client';
import type { StaffAccessRequestStatus } from '../users/user-contract.config';

export type HistoryAuditMetadataView =
  | {
      readonly schemaVersion: 1;
      readonly recordKind: 'SIGNUP' | 'BOOTSTRAP';
    }
  | {
      readonly schemaVersion: 1;
      readonly recordKind: 'TYPE_SELECTION';
      readonly before: UserType;
      readonly after: UserType;
    }
  | {
      readonly schemaVersion: 1;
      readonly recordKind: 'REQUEST_TRANSITION';
      readonly requestId: string;
      readonly status: StaffAccessRequestStatus;
      readonly cause?: 'SUPERSEDED' | 'TYPE_CHANGED' | 'ADMIN_TYPE_CHANGE';
      readonly replacementRequestId?: string | null;
    };
