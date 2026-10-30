export class SubmissionMembershipChangedError extends Error {
  override readonly name = 'SubmissionMembershipChangedError';

  constructor(
    readonly applicationId: string,
    readonly userId: string,
  ) {
    super('제출 권한이 트랜잭션 도중 사라졌습니다.');
  }
}
