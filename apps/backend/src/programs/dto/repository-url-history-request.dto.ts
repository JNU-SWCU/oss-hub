import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RepositoryUrlHistoryRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  cursor?: string;
}
