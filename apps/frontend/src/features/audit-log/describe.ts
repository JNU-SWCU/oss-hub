import {
  AUDIT_LOG_ACTION_LABELS,
  type AuditLogAction,
  type AuditLogRecord,
} from './types';
import {
  fallbackDescription,
  type AuditLogDescription,
} from './describe-segments';
import { SENTENCE_TEMPLATES } from './describe-templates';

export {
  AUDIT_LOG_TARGET_TYPE_LABELS,
  TARGETLESS_FALLBACK_TARGET_TYPES,
  describeTargetType,
  isFallbackTarget,
  type AuditLogDescription,
  type AuditLogSentenceSegment,
  type AuditLogTargetVariant,
} from './describe-segments';

function isKnownAction(action: string): action is AuditLogAction {
  return Object.hasOwn(AUDIT_LOG_ACTION_LABELS, action);
}

export function describeAuditLog(record: AuditLogRecord): AuditLogDescription {
  if (isKnownAction(record.action)) {
    return { sentence: SENTENCE_TEMPLATES[record.action](record) };
  }
  return fallbackDescription(record);
}
