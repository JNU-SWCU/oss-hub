import { RepositoryConnectionMode } from '@prisma/client';
import {
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

/**
 * NEW면 repositoryUrl 없음(null/undefined), OWN이면 https URL이 필수.
 * property 단위 `@ValidateIf`는 다른 검증까지 함께 끄므로 presence와 format을 한 제약에 둔다.
 *
 * DTO 파일이 아니라 여기 사는 이유: `src/**\/dto/*.ts`는 클래스 이름을 `*RequestDto`/`*ResponseDto`로
 * 강제한다(eslint naming-convention). 검증 제약은 DTO가 아니므로 그 규칙 밖에 둔다.
 */
@ValidatorConstraint({
  name: 'applicationRepositoryUrlByConnectionMode',
  async: false,
})
export class RepositoryUrlByConnectionModeConstraint implements ValidatorConstraintInterface {
  validate(repositoryUrl: unknown, args: ValidationArguments): boolean {
    if (resolveMode(args) === RepositoryConnectionMode.OWN) {
      return typeof repositoryUrl === 'string' && isHttpsUrl(repositoryUrl);
    }
    return repositoryUrl === undefined || repositoryUrl === null;
  }

  defaultMessage(args: ValidationArguments): string {
    if (resolveMode(args) === RepositoryConnectionMode.OWN) {
      return 'repositoryUrl must be a valid https URL when repositoryConnectionMode is OWN';
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

function isHttpsUrl(value: string): boolean {
  if (value.length === 0 || !URL.canParse(value)) {
    return false;
  }
  return new URL(value).protocol === 'https:';
}
