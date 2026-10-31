import { Transform } from 'class-transformer';
import { IsString, MaxLength, ValidateBy } from 'class-validator';
import { parseGithubRepositoryUrl } from '../../github/repository-url.config';

export class UpdateStudentRepositoryUrlRequestDto {
  @Transform(({ value }: { readonly value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(250)
  @ValidateBy({
    name: 'githubRepositoryUrl',
    validator: {
      validate: (value: unknown): boolean =>
        typeof value === 'string' && parseGithubRepositoryUrl(value) !== null,
    },
  })
  declare readonly repositoryUrl: string;
}
