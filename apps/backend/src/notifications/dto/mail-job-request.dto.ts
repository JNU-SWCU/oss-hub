import { IsIn, IsObject } from 'class-validator';
export class MailJobRequestDto {
  @IsIn(['PROGRAM', 'DEADLINE'])
  declare readonly kind: 'PROGRAM' | 'DEADLINE';
  @IsObject()
  declare readonly draft: object;
}
