export class ApplicationReviewHistoryTargetMissingError extends Error {
  override readonly name = 'ApplicationReviewHistoryTargetMissingError';

  constructor(readonly teamId: string) {
    super('append 대상 신청을 찾을 수 없다');
  }
}
