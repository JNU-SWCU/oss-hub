import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsArray,
  IsDefined,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateApplicationRequestDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  declare readonly inviteeUserIds?: readonly string[];

  @IsDefined()
  @IsObject()
  declare readonly answers: Readonly<Record<string, unknown>>;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  declare readonly teamName?: string | null;

  @Type(() => Number)
  @IsInt()
  declare readonly applicationTemplateVersion: number;

  @IsOptional()
  @IsBoolean()
  declare readonly isRepositoryPublicationPlanned?: boolean;
}
