import { IsBoolean, IsOptional } from 'class-validator';

export class CollectionTriggerRequestDto {
  @IsOptional()
  @IsBoolean()
  declare readonly fullScan?: boolean;
}
