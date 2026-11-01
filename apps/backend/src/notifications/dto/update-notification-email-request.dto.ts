import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail } from 'class-validator';

function trimString({ value }: { value: unknown }): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class UpdateNotificationEmailRequestDto {
  @Transform(trimString)
  @IsEmail()
  declare readonly notificationEmail: string;

  @IsBoolean()
  declare readonly notifyEnabled: boolean;
}
