import { IsString, MaxLength } from 'class-validator';

export class SearchApplicationPreparationRequestDto {
  @IsString()
  @MaxLength(100)
  declare readonly query: string;
}
