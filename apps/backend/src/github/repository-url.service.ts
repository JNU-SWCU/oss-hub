import { GithubRepositoryCoordinates } from './repository-url.config';
import { Injectable } from '@nestjs/common';

@Injectable()
export class RepositoryUrlService {
  parseGithubRepositoryUrl(
    repositoryUrl: string,
  ): GithubRepositoryCoordinates | null {
    if (!URL.canParse(repositoryUrl)) {
      return null;
    }
    const parsed = new URL(repositoryUrl);
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== 'github.com' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.port !== '' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      return null;
    }
    const segments = parsed.pathname.split('/').filter((part) => part !== '');
    if (segments.length !== 2) {
      return null;
    }
    const [owner, name] = segments;
    if (
      owner === undefined ||
      name === undefined ||
      !isGithubOwnerSegment(owner) ||
      !isGithubRepositoryNameSegment(name)
    ) {
      return null;
    }
    return { owner, name };
  }

  repositoryNameFromNameWithOwner(nameWithOwner: string): string {
    const slashIndex = nameWithOwner.lastIndexOf('/');
    return slashIndex === -1
      ? nameWithOwner
      : nameWithOwner.slice(slashIndex + 1);
  }

  repositoryUrlFromNameWithOwner(nameWithOwner: string): string {
    return `https://github.com/${nameWithOwner}`;
  }

  splitNameWithOwner(nameWithOwner: string): [string, string] {
    const index = nameWithOwner.indexOf('/');
    if (index < 0) {
      throw new Error(
        `invalid collection repository nameWithOwner: ${nameWithOwner}`,
      );
    }
    return [nameWithOwner.slice(0, index), nameWithOwner.slice(index + 1)];
  }
}

function isGithubOwnerSegment(value: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(value);
}

function isGithubRepositoryNameSegment(value: string): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value) &&
    !value.toLowerCase().endsWith('.git')
  );
}
