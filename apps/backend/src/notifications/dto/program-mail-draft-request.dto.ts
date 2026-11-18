import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { PROGRAM_MAIL_RECIPIENT_LIMIT } from '../program-mail.config';

export class ProgramMailDraftRequestDto {
  @IsString()
  @Length(1, 200)
  declare readonly subject: string;

  @IsString()
  @Length(1, 4000)
  declare readonly body: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PROGRAM_MAIL_RECIPIENT_LIMIT)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  declare readonly applicantIds: string[];
}
