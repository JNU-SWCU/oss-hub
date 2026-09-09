import { IsDateString, Matches } from 'class-validator';
import type { DeadlineDigestSendRequest } from '../deadline-digest.service';
import { DeadlineDigestGuidanceRequestDto } from './deadline-digest-guidance-request.dto';

export class DeadlineDigestSendRequestDto
  extends DeadlineDigestGuidanceRequestDto
  implements DeadlineDigestSendRequest
{
  @IsDateString({ strict: true, strictSeparator: true })
  declare readonly previewedAt: string;

  @Matches(/^[a-f0-9]{64}$/u)
  declare readonly previewVersion: string;
}
