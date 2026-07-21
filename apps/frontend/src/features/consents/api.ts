import { ApiError, apiClient } from '@/lib/api-client';

export interface ConsentRequiredItem {
  readonly key: string;
  readonly label: string;
  readonly documentUrl: string;
}

export interface CurrentConsent {
  readonly policyVersion: string;
  readonly requiredItems: readonly ConsentRequiredItem[];
  readonly consented: boolean;
  readonly nextUrl: string;
}

export interface AcceptConsentRequest {
  readonly policyVersion: string;
  readonly acceptedItems: readonly string[];
}

export interface AcceptedConsent {
  readonly policyVersion: string;
  readonly consentedAt: string;
  readonly nextUrl: string;
}

export type ConsentApiErrorKind =
  'unauthorized' | 'stale' | 'validation' | 'generic';

export class ConsentResponseError extends Error {
  constructor() {
    super('동의 API 응답 형식이 올바르지 않습니다.');
    this.name = 'ConsentResponseError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isInternalPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\')
  );
}

function isDocumentUrl(value: unknown): value is string {
  return (
    isInternalPath(value) ||
    (typeof value === 'string' && value.startsWith('https://'))
  );
}

function isRequiredItem(value: unknown): value is ConsentRequiredItem {
  return (
    isRecord(value) &&
    isNonEmptyString(value.key) &&
    isNonEmptyString(value.label) &&
    isDocumentUrl(value.documentUrl)
  );
}

function parseCurrentConsent(value: unknown): CurrentConsent {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.policyVersion) ||
    !Array.isArray(value.requiredItems) ||
    value.requiredItems.length === 0 ||
    !value.requiredItems.every(isRequiredItem) ||
    typeof value.consented !== 'boolean' ||
    !isInternalPath(value.nextUrl)
  ) {
    throw new ConsentResponseError();
  }

  const keys = value.requiredItems.map((item) => item.key);
  if (new Set(keys).size !== keys.length) {
    throw new ConsentResponseError();
  }

  return {
    policyVersion: value.policyVersion,
    requiredItems: value.requiredItems.map((item) => ({ ...item })),
    consented: value.consented,
    nextUrl: value.nextUrl,
  };
}

function parseAcceptedConsent(value: unknown): AcceptedConsent {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.policyVersion) ||
    !isNonEmptyString(value.consentedAt) ||
    !Number.isFinite(Date.parse(value.consentedAt)) ||
    !isInternalPath(value.nextUrl)
  ) {
    throw new ConsentResponseError();
  }

  return {
    policyVersion: value.policyVersion,
    consentedAt: value.consentedAt,
    nextUrl: value.nextUrl,
  };
}

export async function getCurrentConsent(
  signal?: AbortSignal,
): Promise<CurrentConsent> {
  const value = await apiClient<unknown>(
    'consents/current',
    signal ? { signal } : undefined,
  );
  return parseCurrentConsent(value);
}

export async function acceptConsent(
  request: AcceptConsentRequest,
  signal?: AbortSignal,
): Promise<AcceptedConsent> {
  const value = await apiClient<unknown>('consents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    ...(signal ? { signal } : {}),
  });
  return parseAcceptedConsent(value);
}

export function classifyConsentApiError(error: unknown): ConsentApiErrorKind {
  if (!(error instanceof ApiError)) {
    return 'generic';
  }
  if (error.problem.status === 401) {
    return 'unauthorized';
  }
  if (error.problem.status === 409 && error.problem.code === 'CON_002') {
    return 'stale';
  }
  if (error.problem.status === 422 && error.problem.code === 'CON_003') {
    return 'validation';
  }
  return 'generic';
}
