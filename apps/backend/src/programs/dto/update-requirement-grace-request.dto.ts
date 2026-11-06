import { IsISO8601, Matches, ValidateIf } from 'class-validator';

export class UpdateRequirementGraceRequestDto {
  @ValidateIf((_, value: unknown) => value !== null)
  @IsISO8601({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  declare readonly graceDueAt: string | null;
}
