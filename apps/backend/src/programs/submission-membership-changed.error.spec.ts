import { SubmissionMembershipChangedError } from './submission-membership-changed.error';

const APPLICATION_ID = 'synthetic-application';
const DEPARTED_ID = 'synthetic-departed';

describe('SubmissionMembershipChangedError', () => {
  it('소비자가 NOT_APPLICATION_MEMBER 로 매핑할 수 있게 맥락을 담는다', () => {
    const error = new SubmissionMembershipChangedError(
      APPLICATION_ID,
      DEPARTED_ID,
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SubmissionMembershipChangedError');
    expect(error.message).toBe('제출 권한이 트랜잭션 도중 사라졌습니다.');
    expect(error.applicationId).toBe(APPLICATION_ID);
    expect(error.userId).toBe(DEPARTED_ID);
  });
});
