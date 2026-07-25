import { selectGithubPrimaryEmail } from './github-primary-email';

describe('selectGithubPrimaryEmail', () => {
  it('primary+verified를 최우선으로 고른다', () => {
    expect(
      selectGithubPrimaryEmail([
        { email: 'other@example.com', primary: false, verified: true },
        { email: 'primary@example.com', primary: true, verified: true },
        { email: 'unverified@example.com', primary: true, verified: false },
      ]),
    ).toBe('primary@example.com');
  });

  it('primary+verified가 없으면 primary를 고른다', () => {
    expect(
      selectGithubPrimaryEmail([
        { email: 'verified@example.com', primary: false, verified: true },
        { email: 'primary@example.com', primary: true, verified: false },
      ]),
    ).toBe('primary@example.com');
  });

  it('primary가 없으면 첫 verified를 고른다', () => {
    expect(
      selectGithubPrimaryEmail([
        { email: 'first@example.com', primary: false, verified: true },
        { email: 'second@example.com', primary: false, verified: true },
      ]),
    ).toBe('first@example.com');
  });

  it('후보가 없으면 null이다', () => {
    expect(
      selectGithubPrimaryEmail([
        { email: 'a@example.com', primary: false, verified: false },
      ]),
    ).toBeNull();
    expect(selectGithubPrimaryEmail([])).toBeNull();
  });
});
