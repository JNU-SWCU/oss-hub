import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateApplicationPreparationRequestDto {
  @Transform(({ value }: { readonly value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  declare readonly name: string;
}

export class InviteApplicationPreparationRequestDto {
  @IsString()
  @IsNotEmpty()
  declare readonly inviteeUserId: string;
}

export class SearchApplicationPreparationRequestDto {
  @IsString()
  @MaxLength(100)
  declare readonly query: string;
}
