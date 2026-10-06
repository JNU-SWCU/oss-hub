export const COLLECTION_TRIGGER_PORT = Symbol('COLLECTION_TRIGGER_PORT');

export interface CollectionTriggerPort {
  collectRepository(githubRepositoryId: bigint): void;
}
