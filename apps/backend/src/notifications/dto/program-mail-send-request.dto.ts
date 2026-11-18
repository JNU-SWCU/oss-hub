import { IsISO8601, IsString, Length } from 'class-validator';
import { ProgramMailDraftRequestDto } from './program-mail-draft-request.dto';

export class ProgramMailSendRequestDto extends ProgramMailDraftRequestDto {
  @IsISO8601({ strict: true })
  declare readonly previewedAt: string;

  @IsString()
  @Length(64, 64)
  declare readonly previewVersion: string;
}
