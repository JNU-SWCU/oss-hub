import { BadRequestException } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { RepositoryUrlHistoryCursor } from '../program-team-repository-evidence.types';

export class RepositoryUrlHistoryQueryRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  cursor?: string;

  toCursor(): RepositoryUrlHistoryCursor | undefined {
    if (this.cursor === undefined) return undefined;
    const match =
      /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)_([a-zA-Z0-9:-]+)$/.exec(
        this.cursor,
      );
    const timestamp = match?.[1];
    const id = match?.[2];
    if (!timestamp || !id)
      throw new BadRequestException('Invalid history cursor');
    const occurredAt = new Date(timestamp);
    if (
      !Number.isFinite(occurredAt.getTime()) ||
      occurredAt.toISOString() !== timestamp
    )
      throw new BadRequestException('Invalid history cursor');
    return { occurredAt, id };
  }
}
