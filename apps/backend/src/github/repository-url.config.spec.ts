import { GITHUB_REPOSITORY_URL_PATTERN } from './repository-url.config';

describe('GITHUB_REPOSITORY_URL_PATTERN', () => {
  it.each([
    'https://github.com/owner/repo',
    'https://github.com/owner/repo/',
    'https://GitHub.com/Owner/Repo',
    'https://github.com/my-org/repo.name_1',
  ])('표준 저장소 주소 %s 를 받는다', (url) => {
    expect(GITHUB_REPOSITORY_URL_PATTERN.test(url)).toBe(true);
  });

  it.each([
    'https://github.com:443/owner/repo',
    'https://github.com/owner/repo?',
    'https://github.com/owner/repo#',
    'https://@github.com/owner/repo',
    'https://github.com//owner/repo',
    'https://github.com/owner/../owner/repo',
    'https:github.com/owner/repo',
    'https://%67ithub.com/owner/repo',
    'https://github.com/owner/repo.git',
    'http://github.com/owner/repo',
    'https://github.com/-owner/repo',
    'https://github.com/owner',
  ])('표준이 아닌 주소 %s 는 거부한다', (url) => {
    expect(GITHUB_REPOSITORY_URL_PATTERN.test(url)).toBe(false);
  });
});
