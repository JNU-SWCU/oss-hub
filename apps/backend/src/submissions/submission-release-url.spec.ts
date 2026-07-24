import { isLinkedRepositoryReleaseUrl } from './submission-release-url';

describe('isLinkedRepositoryReleaseUrl', () => {
  const repositoryUrl = 'https://github.com/JNU-SWCU/synthetic-repository';

  it('연결 저장소의 release tag URL을 허용한다', () => {
    // Given
    const releaseUrl = `${repositoryUrl}/releases/tag/v1.0.0`;

    // When
    const linked = isLinkedRepositoryReleaseUrl(repositoryUrl, releaseUrl);

    // Then
    expect(linked).toBe(true);
  });

  it('연결 저장소의 tag tree URL을 허용한다', () => {
    // Given
    const releaseUrl = `${repositoryUrl}/tree/v1.0.0`;

    // When
    const linked = isLinkedRepositoryReleaseUrl(repositoryUrl, releaseUrl);

    // Then
    expect(linked).toBe(true);
  });

  it('다른 저장소와 저장소 루트 URL을 거절한다', () => {
    // Given
    const candidates = [
      'https://github.com/JNU-SWCU/other/releases/tag/v1.0.0',
      repositoryUrl,
      `${repositoryUrl}/releases/tag/`,
    ];

    // When
    const results = candidates.map((candidate) =>
      isLinkedRepositoryReleaseUrl(repositoryUrl, candidate),
    );

    // Then
    expect(results).toEqual([false, false, false]);
  });

  it('형식이 잘못된 URL을 거절한다', () => {
    // Given
    const releaseUrl = 'not-a-url';

    // When
    const linked = isLinkedRepositoryReleaseUrl(repositoryUrl, releaseUrl);

    // Then
    expect(linked).toBe(false);
  });
});
