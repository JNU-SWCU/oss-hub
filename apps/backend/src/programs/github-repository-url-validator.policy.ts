import {
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { parseGithubRepositoryUrl } from '../github/github-repository-url.policy';

@ValidatorConstraint({ name: 'githubRepositoryUrl', async: false })
export class GithubRepositoryUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      typeof value === 'string' && parseGithubRepositoryUrl(value) !== null
    );
  }
}
