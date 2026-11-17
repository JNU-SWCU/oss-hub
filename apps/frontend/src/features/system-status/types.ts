export type CollectionHealth = 'EMPTY' | 'NORMAL' | 'DELAYED';

interface CollectionStatus {
  readonly health: CollectionHealth;
  readonly trackedRepositoryCount: number;
  readonly staleRepositoryCount: number;
  readonly lastSuccessAt: string | null;
  readonly nextCycleAt: string | null;
  readonly currentRunStatus: 'IDLE' | 'PROCESSING';
}

export interface ProvisioningFailedTeam {
  readonly teamId: string;
  readonly teamName: string;
  readonly programName: string;
  readonly lastErrorCode: string | null;
  readonly updatedAt: string;
}

interface ProvisioningStatus {
  readonly pending: number;
  readonly processing: number;
  readonly retryable: number;
  readonly failedFinal: number;
  readonly failedTeams: readonly ProvisioningFailedTeam[];
}

interface MailStatus {
  readonly sent7d: number;
  readonly failed7d: number;
  readonly lastSentAt: string | null;
}

export type AnomalyRule =
  | 'BULK_REMOVAL'
  | 'SELF_ADMIN_CHANGE'
  | 'OFF_HOURS_ADMIN_CHANGE'
  | 'PROVISIONING_FAILED'
  | 'COLLECTION_STALE'
  | 'MAIL_FAILED';

export type AnomalySeverity = 'HIGH' | 'MEDIUM';

export interface Anomaly {
  readonly rule: AnomalyRule;
  readonly severity: AnomalySeverity;
  readonly count: number;
  readonly target: { readonly kind: 'USER'; readonly id: string } | null;
}

export interface SystemStatus {
  readonly collection: CollectionStatus;
  readonly provisioning: ProvisioningStatus;
  readonly mail: MailStatus;
  readonly anomalies: readonly Anomaly[];
}

export type SystemStatusViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | {
      readonly kind: 'success';
      readonly freshness: 'current' | 'refreshing' | 'stale';
      readonly status: SystemStatus;
    };

export interface ActionNotice {
  readonly kind: 'success' | 'error';
  readonly message: string;
}
