import { Transform } from 'class-transformer';
import { IsString, Matches, MaxLength } from 'class-validator';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class RenameTeamRequestDto {
  @Transform(({ value }: { readonly value: unknown }) => trimString(value))
  @IsString()
  @Matches(/\S/u)
  @MaxLength(100)
  declare readonly name: string;
}
