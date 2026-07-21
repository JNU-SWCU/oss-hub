import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class LoginHistoryQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  readonly page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  readonly size: number = 20;
}
