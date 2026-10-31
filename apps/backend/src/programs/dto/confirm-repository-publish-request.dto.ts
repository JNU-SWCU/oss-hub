import { IsBoolean } from 'class-validator';

export class ConfirmRepositoryPublishRequestDto {
  @IsBoolean()
  declare readonly isConfirmed: boolean;
}
