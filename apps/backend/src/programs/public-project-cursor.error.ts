export class PublicProjectCursorSecretError extends Error {
  readonly envName = 'SESSION_SECRET';

  constructor(reason: string) {
    super(`공개 프로젝트 커서 키를 만들 수 없습니다: ${reason}`);
    this.name = PublicProjectCursorSecretError.name;
  }
}
