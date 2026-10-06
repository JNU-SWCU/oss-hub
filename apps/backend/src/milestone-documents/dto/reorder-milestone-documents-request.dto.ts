import { IsArray, IsNotEmpty, IsString } from 'class-validator';

export class ReorderMilestoneDocumentsRequestDto {
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  declare readonly documentIds: string[];
}
