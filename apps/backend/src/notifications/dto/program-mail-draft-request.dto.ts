import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

const MAX_RECIPIENTS = 5050;

export class ProgramMailDraftRequestDto {
  @IsString()
  @Length(1, 200)
  declare readonly subject: string;

  @IsString()
  @Length(1, 4000)
  declare readonly body: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RECIPIENTS)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  declare readonly applicantIds: string[];
}
