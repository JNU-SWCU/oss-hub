import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CollectionCutoverRepository {
  constructor(private readonly db: PrismaService) {}

  async isQuiesced(now: Date): Promise<boolean> {
    const rows = await this.db.$queryRawUnsafe<Array<{ quiesced: boolean }>>(
      `SELECT EXISTS(SELECT 1 FROM "CollectionCutoverLease" WHERE "expiresAt" > $1) AS "quiesced"`,
      now,
    );
    return rows[0]?.quiesced ?? false;
  }
}
