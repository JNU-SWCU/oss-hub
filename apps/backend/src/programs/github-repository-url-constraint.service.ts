import { Injectable } from '@nestjs/common';
import {
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { RepositoryUrlService } from '../github/repository-url.service';

@Injectable()
@ValidatorConstraint({ name: 'githubRepositoryUrl' })
export class GithubRepositoryUrlConstraintService implements ValidatorConstraintInterface {
  constructor(private readonly repositoryUrlService: RepositoryUrlService) {}

  validate(value: unknown): boolean {
    return (
      typeof value === 'string' &&
      this.repositoryUrlService.parseGithubRepositoryUrl(value) !== null
    );
  }
}
