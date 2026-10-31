export const COLLECTION_STREAM_TYPES = [
  'COMMIT',
  'PULL_REQUEST',
  'RELEASE',
  'ISSUE',
] as const;

export type CollectionStreamType = (typeof COLLECTION_STREAM_TYPES)[number];
