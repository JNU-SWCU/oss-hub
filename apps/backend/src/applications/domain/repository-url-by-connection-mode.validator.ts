import { RepositoryConnectionMode } from '@prisma/client';
import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { parseGithubRepositoryUrl } from '../../github/domain/github-repository-url';

@ValidatorConstraint({
  name: 'applicationRepositoryUrlByConnectionMode',
  async: false,
})
export class RepositoryUrlByConnectionModeConstraint implements ValidatorConstraintInterface {
  validate(repositoryUrl: unknown, args: ValidationArguments): boolean {
    if (resolveMode(args) === RepositoryConnectionMode.OWN) {
      return (
        typeof repositoryUrl === 'string' &&
        parseGithubRepositoryUrl(repositoryUrl) !== null
      );
    }
    return repositoryUrl === undefined || repositoryUrl === null;
  }

  defaultMessage(args: ValidationArguments): string {
    if (resolveMode(args) === RepositoryConnectionMode.OWN) {
      return 'repositoryUrl must be a valid GitHub repository URL when repositoryConnectionMode is OWN';
    }
    return 'repositoryUrl must be null when repositoryConnectionMode is NEW';
  }
}

function resolveMode(args: ValidationArguments): RepositoryConnectionMode {
  const mode = (args.object as { readonly repositoryConnectionMode?: unknown })
    .repositoryConnectionMode;
  return mode === RepositoryConnectionMode.OWN
    ? RepositoryConnectionMode.OWN
    : RepositoryConnectionMode.NEW;
}
