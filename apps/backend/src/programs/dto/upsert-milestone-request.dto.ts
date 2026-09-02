import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpsertMilestoneRequestDto {
  @IsString()
  @IsNotEmpty()
  declare name: string;

  @IsOptional()
  @IsDateString({ strict: true, strictSeparator: true })
  declare startAt?: string;

  @IsString()
  declare dueAt: string;

  @IsOptional()
  @IsString()
  declare instructions?: string | null;
}
