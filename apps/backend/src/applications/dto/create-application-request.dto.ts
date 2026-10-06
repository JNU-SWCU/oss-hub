import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type { CreateApplicationInput } from '../domain/create-application';

export class CreateApplicationRequestDto {
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

  toInput(): CreateApplicationInput {
    const trimmedTeamName = this.teamName?.trim();

    return {
      answers: this.answers,
      teamName:
        trimmedTeamName !== undefined && trimmedTeamName.length > 0
          ? trimmedTeamName
          : null,
      applicationTemplateVersion: this.applicationTemplateVersion,
      isRepositoryPublicationPlanned:
        this.isRepositoryPublicationPlanned ?? true,
    };
  }
}
