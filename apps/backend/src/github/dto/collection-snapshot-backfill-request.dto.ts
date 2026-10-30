import { Type } from 'class-transformer';
import { IsInt } from 'class-validator';

export class CollectionSnapshotBackfillRequestDto {
  @Type(() => Number)
  @IsInt()
  readonly year!: number;
}
