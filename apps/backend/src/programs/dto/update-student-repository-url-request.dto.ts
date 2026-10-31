import { Transform } from 'class-transformer';
import { IsString, MaxLength, ValidateBy } from 'class-validator';
import { GITHUB_REPOSITORY_URL_PATTERN } from '../../github/repository-url.config';

export class UpdateStudentRepositoryUrlRequestDto {
  @Transform(({ value }: { readonly value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(250)
  @ValidateBy({
    name: 'githubRepositoryUrl',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' && GITHUB_REPOSITORY_URL_PATTERN.test(value),
    },
  })
  declare readonly repositoryUrl: string;
}
