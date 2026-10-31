import { IsString } from 'class-validator';

export class SelectRoleRequestDto {
  @IsString()
  declare readonly selectedRole: string;
}
