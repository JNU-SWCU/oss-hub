import type {
  GithubRepositoryMetadata,
  GithubPublicRepositoryMetadata,
} from './github-app.client';

export type OwnGithubRepositoryResolution =
  | {
      readonly kind: 'ORGANIZATION';
      readonly repository: GithubRepositoryMetadata;
    }
  | {
      readonly kind: 'EXTERNAL';
      readonly repository: GithubPublicRepositoryMetadata;
    };
