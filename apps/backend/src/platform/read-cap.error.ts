export class ReadCapExceededError extends Error {
  constructor(
    readonly scope: string,
    readonly cap: number,
  ) {
    super(
      `${scope} 읽기 상한 ${cap}건을 넘었습니다. 상한을 다시 정하거나 페이지로 나누세요.`,
    );
    this.name = 'ReadCapExceededError';
  }
}
