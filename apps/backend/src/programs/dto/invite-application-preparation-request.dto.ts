import { IsNotEmpty, IsString } from 'class-validator';

export class InviteApplicationPreparationRequestDto {
  @IsString()
  @IsNotEmpty()
  declare readonly inviteeUserId: string;
}
