export const COLLECTION_TRIGGER_PORT = Symbol('COLLECTION_TRIGGER_PORT');

export interface CollectionTriggerPort {
  /**
   * 방금 연결한 저장소를 바로 수집하기 시작한다. 결과를 기다리지 않고 던지지도 않는다 —
   * 이 수집을 놓치면 매시 sweep이 채운다.
   */
  collectRepository(githubRepositoryId: bigint): void;
}
