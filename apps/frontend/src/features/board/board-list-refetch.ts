const BOARD_LIST_INVALIDATED_EVENT = 'oss-hub:board-list-invalidated';

interface BoardListInvalidatedDetail {
  readonly programId: string;
}

/** 캐시된 목록 화면에도 게시판 변경을 알린다. 마운트되지 않은 목록은 진입 effect가 조회한다. */
export function invalidateBoardList(programId: string): void {
  window.dispatchEvent(
    new CustomEvent<BoardListInvalidatedDetail>(BOARD_LIST_INVALIDATED_EVENT, {
      detail: { programId },
    }),
  );
}

export function subscribeBoardListInvalidation(
  programId: string,
  listener: () => void,
): () => void {
  const handleInvalidation = (event: Event) => {
    if (
      event instanceof CustomEvent &&
      (event.detail as BoardListInvalidatedDetail).programId === programId
    ) {
      listener();
    }
  };
  window.addEventListener(BOARD_LIST_INVALIDATED_EVENT, handleInvalidation);
  return () =>
    window.removeEventListener(
      BOARD_LIST_INVALIDATED_EVENT,
      handleInvalidation,
    );
}
