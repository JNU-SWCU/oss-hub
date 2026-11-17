import { Injectable } from '@nestjs/common';
import { READ_BATCH_SIZE } from './bounded-read.config';
import { ReadCapExceededError } from './read-cap.error';

@Injectable()
export class BoundedReadRepository {
  async readCapped<R extends readonly unknown[]>(
    cap: number,
    scope: string,
    read: (take: number) => PromiseLike<R>,
  ): Promise<R> {
    const rows = await read(cap + 1);
    if (rows.length > cap) throw new ReadCapExceededError(scope, cap);
    return rows;
  }

  async forEachBatch<R, K>(
    read: (after: K | undefined, take: number) => PromiseLike<readonly R[]>,
    cursorOf: (row: R) => K,
    handle: (rows: readonly R[]) => unknown,
  ): Promise<void> {
    const step = async (after: K | undefined): Promise<void> => {
      const rows = await read(after, READ_BATCH_SIZE);
      await handle(rows);
      const last = rows.at(-1);
      if (rows.length === READ_BATCH_SIZE && last !== undefined)
        return step(cursorOf(last));
    };
    return step(undefined);
  }

  async readAllInBatches<R, K>(
    read: (after: K | undefined, take: number) => PromiseLike<readonly R[]>,
    cursorOf: (row: R) => K,
  ): Promise<R[]> {
    const rows: R[] = [];
    await this.forEachBatch(read, cursorOf, (batch) => rows.push(...batch));
    return rows;
  }
}
