import { Injectable } from '@nestjs/common';
import { READ_BATCH_SIZE, type NestedReadCaps } from './bounded-read.config';
import { ReadCapExceededError } from './read-cap.error';

@Injectable()
export class BoundedReadRepository {
  async readCapped<R extends readonly unknown[]>(
    cap: number,
    scope: string,
    read: (take: number) => PromiseLike<R>,
    nested: NestedReadCaps = {},
  ): Promise<R> {
    const rows = await read(cap + 1);
    if (rows.length > cap) throw new ReadCapExceededError(scope, cap);
    this.assertNestedWithin(rows, nested, scope);
    return rows;
  }

  assertNestedWithin<T>(value: T, nested: NestedReadCaps, scope: string): T {
    const parents: readonly unknown[] = Array.isArray(value) ? value : [value];
    for (const [relation, rule] of Object.entries(nested)) {
      const cap = typeof rule === 'number' ? rule : rule.cap;
      const children = parents.flatMap((parent) => {
        if (typeof parent !== 'object' || parent === null) return [];
        const child: unknown = (parent as Record<string, unknown>)[relation];
        if (!Array.isArray(child)) return child === undefined ? [] : [child];
        if (cap !== undefined && child.length > cap)
          throw new ReadCapExceededError(`${scope}.${relation}`, cap);
        return child as unknown[];
      });
      if (typeof rule !== 'number')
        this.assertNestedWithin(children, rule.nested, `${scope}.${relation}`);
    }
    return value;
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
