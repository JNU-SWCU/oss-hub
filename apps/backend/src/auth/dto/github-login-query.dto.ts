import { Equals, ValidateIf } from 'class-validator';

export class GithubLoginQueryRequestDto {
  @ValidateIf((_query: unknown, value: unknown) => value !== undefined)
  @Equals('select_account')
  readonly prompt?: 'select_account';
}
