import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class UpdateMilestoneDocumentRequestDto {
  @IsDefined()
  @ValidateIf((_object, value: unknown) => value !== null)
  @Transform(({ value }: { readonly value: unknown }) => trimString(value))
  @IsString()
  @Matches(/\S/u)
  declare readonly id: string | null;

  @Transform(({ value }: { readonly value: unknown }) => trimString(value))
  @IsString()
  @Matches(/\S/u)
  @MaxLength(200)
  declare readonly name: string;

  @IsBoolean()
  declare readonly required: boolean;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { readonly value: unknown }) => trimString(value))
  @IsString()
  @Matches(/\S/u)
  @MaxLength(128)
  declare readonly templateUploadId?: string;
}

export class UpdateMilestoneRequestDto {
  @Transform(({ value }: { readonly value: unknown }) => trimString(value))
  @IsString()
  @Matches(/\S/u)
  @MaxLength(200)
  declare readonly name: string;

  @IsDateString({ strict: true, strictSeparator: true })
  declare readonly startAt: string;

  @IsDateString({ strict: true, strictSeparator: true })
  declare readonly dueAt: string;

  @IsDefined()
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsString()
  @MaxLength(10_000)
  declare readonly instructions: string | null;

  @IsDefined()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => UpdateMilestoneDocumentRequestDto)
  declare readonly documents: readonly UpdateMilestoneDocumentRequestDto[];

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  declare readonly expectedFingerprint: string;
}
