import { Injectable } from '@nestjs/common';
import { AuditSourceAdapterService } from './audit-source-adapter.service';
import type { AuditEntry, AuditSourceRow } from './audit-entry.types';

const REVISION_ACTIONS: ReadonlySet<string> = new Set([
  'SUBMISSION_SUBMITTED',
  'SUBMISSION_RESUBMITTED',
]);

@Injectable()
export class SubmissionAuditSourceService extends AuditSourceAdapterService {
  toAuditEntry(row: AuditSourceRow): AuditEntry {
    const metadata = this.storedMetadata(row);
    const revision = metadata?.revision;
    return this.entry(row, metadata, {
      change:
        REVISION_ACTIONS.has(row.action) && typeof revision === 'number'
          ? { before: null, after: String(revision) }
          : null,
    });
  }
}
