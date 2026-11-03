import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { type UpsertMilestoneCommand } from '../program-editor.service';

export class UpsertMilestoneRequestDto implements UpsertMilestoneCommand {
  @IsString()
  @IsNotEmpty()
  declare name: string;

  @IsDateString({ strict: true, strictSeparator: true })
  declare startAt: string;

  @IsString()
  declare dueAt: string;

  @IsOptional()
  @IsString()
  declare instructions?: string | null;
}
