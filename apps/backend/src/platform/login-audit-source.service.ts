import { Injectable } from '@nestjs/common';
import { AuditSourceAdapterService } from './audit-source-adapter.service';
import type { AuditEntry, AuditSourceRow } from './audit-entry.types';

@Injectable()
export class LoginAuditSourceService extends AuditSourceAdapterService {
  toAuditEntry(row: AuditSourceRow): AuditEntry {
    return this.entry(row, this.storedMetadata(row), { change: null });
  }
}
