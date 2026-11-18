export type CollectionHealth = 'EMPTY' | 'NORMAL' | 'DELAYED';

interface CollectionStatus {
  readonly health: CollectionHealth;
  readonly trackedRepositoryCount: number;
  readonly staleRepositoryCount: number;
  readonly lastSuccessAt: string | null;
  readonly nextCycleAt: string | null;
  readonly currentRunStatus: 'IDLE' | 'PROCESSING';
}

export interface CollectionRepository {
  readonly repositoryName: string;
  readonly programName: string | null;
  readonly lastSuccessAt: string | null;
}

export interface StaleRepositoryPage {
  readonly items: readonly CollectionRepository[];
  readonly total: number;
}

interface ExternalCollectionStatus {
  readonly trackedRepositoryCount: number;
  readonly lastSuccessAt: string | null;
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
  readonly failedTeamsHasMore: boolean;
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
  readonly target: {
    readonly id: string;
    readonly login: string | null;
  } | null;
}

export interface SystemStatus {
  readonly collection: CollectionStatus;
  readonly provisioning: ProvisioningStatus;
  readonly mail: MailStatus;
  readonly anomalies: readonly Anomaly[];
  readonly staleRepositories: StaleRepositoryPage;
  readonly externalCollection: ExternalCollectionStatus;
}

export type SystemStatusViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | {
      readonly kind: 'success';
      readonly freshness: 'current' | 'refreshing' | 'stale';
      readonly status: SystemStatus;
    };

export interface StaleRepositoryPager {
  readonly page: number;
  readonly isLoading: boolean;
  readonly onPageChange: (page: number) => void;
}

export interface ActionNotice {
  readonly kind: 'success' | 'error';
  readonly message: string;
}
