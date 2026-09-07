export const DOCUMENT_DELIVERY_LABELS = {
  MISSING: '미제출 있음',
  LATE: '지각 제출',
  COMPLETE: '제출 완료',
  NO_REQUIRED_ITEMS: '필수 서류 없음',
} as const;

export type DocumentDeliveryStatus = keyof typeof DOCUMENT_DELIVERY_LABELS;

export const DOCUMENT_DELIVERY_STATUSES = [
  'MISSING',
  'LATE',
  'COMPLETE',
  'NO_REQUIRED_ITEMS',
] as const;

export const DOCUMENT_DELIVERY_VARIANTS = {
  MISSING: 'closed',
  LATE: 'pending',
  COMPLETE: 'recruiting',
  NO_REQUIRED_ITEMS: 'closed',
} as const;
