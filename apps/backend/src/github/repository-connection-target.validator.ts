import { RepositoryConnectionMode } from '@prisma/client';
import {
  ValidatorConstraint,
  type ValidatorConstraintInterface,
  type ValidationArguments,
} from 'class-validator';
import { parseGithubRepositoryUrl } from '../common/github-repository-url';

interface RepositoryConnectionTargetInput {
  readonly mode: RepositoryConnectionMode;
}

@ValidatorConstraint({ name: 'repositoryConnectionTarget', async: false })
export class RepositoryConnectionTargetConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, validationArguments: ValidationArguments): boolean {
    const request =
      validationArguments.object as RepositoryConnectionTargetInput;
    if (request.mode === RepositoryConnectionMode.NEW) {
      return value === undefined || value === null;
    }
    return (
      request.mode === RepositoryConnectionMode.OWN &&
      typeof value === 'string' &&
      parseGithubRepositoryUrl(value) !== null
    );
  }

  defaultMessage(): string {
    return 'OWN 연결에는 정확한 GitHub 저장소 URL이 필요하고 NEW 연결에는 URL을 보낼 수 없습니다.';
  }
}
