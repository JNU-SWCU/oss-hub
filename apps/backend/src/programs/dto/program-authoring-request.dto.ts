import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  registerDecorator,
  ValidateNested,
} from 'class-validator';
import type { ValidationOptions } from 'class-validator';
import { ProgramCategory } from '@prisma/client';

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasAtMostDocuments(value: unknown, maximum: number): boolean {
  if (!isUnknownArray(value)) return true;
  let count = 0;
  for (const milestone of value) {
    if (!isUnknownRecord(milestone) || !isUnknownArray(milestone.documents)) {
      continue;
    }
    count += milestone.documents.length;
    if (count > maximum) return false;
  }
  return true;
}

function AtMostDocuments(
  maximum: number,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (target, propertyKey) =>
    registerDecorator({
      name: 'atMostDocuments',
      target: target.constructor,
      propertyName: String(propertyKey),
      options: validationOptions,
      validator: {
        validate: (value: unknown) => hasAtMostDocuments(value, maximum),
      },
    });
}

export class ProgramAuthoringDocumentRequestDto {
  @IsString()
  @Matches(/\S/u)
  @MaxLength(200)
  declare readonly name: string;

  @IsBoolean()
  declare readonly required: boolean;

  @IsOptional()
  @IsString()
  @Matches(/\S/u)
  @MaxLength(128)
  declare readonly templateUploadId?: string;
}

export class ProgramAuthoringMilestoneRequestDto {
  @IsString()
  @Matches(/\S/u)
  @MaxLength(200)
  declare readonly name: string;

  @IsOptional()
  @IsDateString({ strict: true, strictSeparator: true })
  declare readonly startAt?: string;

  @IsDateString({ strict: true, strictSeparator: true })
  declare readonly dueAt: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  declare readonly instructions?: string | null;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProgramAuthoringDocumentRequestDto)
  declare readonly documents: readonly ProgramAuthoringDocumentRequestDto[];
}

export class ProgramAuthoringRequestDto {
  @IsString()
  @Matches(/\S/u)
  @MaxLength(200)
  declare readonly name: string;

  @IsString()
  @Matches(/\S/u)
  @MaxLength(200)
  declare readonly organizer: string;

  @IsIn(Object.values(ProgramCategory))
  declare readonly category: ProgramCategory;

  @IsDateString({ strict: true, strictSeparator: true })
  declare readonly applicationStartAt: string;

  @IsDateString({ strict: true, strictSeparator: true })
  declare readonly applicationEndAt: string;

  @IsDateString({ strict: true, strictSeparator: true })
  declare readonly startAt: string;

  @IsDateString({ strict: true, strictSeparator: true })
  declare readonly endAt: string;

  @IsInt()
  @Min(1)
  @Max(100)
  declare readonly teamMinSize: number;

  @IsInt()
  @Min(1)
  @Max(100)
  declare readonly teamMaxSize: number;

  @IsBoolean()
  declare readonly repositoryProvisioningEnabled: boolean;

  @IsBoolean()
  declare readonly notifyOnDeadline: boolean;

  @IsString()
  @Matches(/\S/u)
  @MaxLength(10_000)
  declare readonly description: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @AtMostDocuments(100)
  @ValidateNested({ each: true })
  @Type(() => ProgramAuthoringMilestoneRequestDto)
  declare readonly milestones: readonly ProgramAuthoringMilestoneRequestDto[];
}
