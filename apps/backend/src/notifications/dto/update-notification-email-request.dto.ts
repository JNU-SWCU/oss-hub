import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail } from 'class-validator';
import type { UpdateNotificationEmailInput } from '../notification-settings.service';

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class UpdateNotificationEmailRequestDto {
  @Transform(trimString)
  @IsEmail()
  declare readonly notificationEmail: string;

  @IsBoolean()
  declare readonly notifyEnabled: boolean;

  toInput(): UpdateNotificationEmailInput {
    return {
      notificationEmail: this.notificationEmail,
      notifyEnabled: this.notifyEnabled,
    };
  }
}
