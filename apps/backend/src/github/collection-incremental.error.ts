export class StaleSyncEpochError extends Error {
  readonly repositoryId: string;
  readonly streamType: 'COMMIT' | 'PULL_REQUEST' | 'RELEASE' | 'ISSUE';
  readonly claimedEpoch: bigint | null;

  constructor(
    repositoryId: string,
    streamType: 'COMMIT' | 'PULL_REQUEST' | 'RELEASE' | 'ISSUE',
    claimedEpoch: bigint | null,
  ) {
    super(
      `CollectionRepositoryStream ${repositoryId} ${streamType} rejected sync epoch ${claimedEpoch === null ? 'null' : claimedEpoch.toString()}`,
    );
    this.name = 'StaleSyncEpochError';
    this.repositoryId = repositoryId;
    this.streamType = streamType;
    this.claimedEpoch = claimedEpoch;
  }
}
