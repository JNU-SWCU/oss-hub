import { Injectable } from '@nestjs/common';
import { defer, lastValueFrom, repeat, takeWhile } from 'rxjs';

type Step<Item> = (item: Item, index: number) => Promise<void | 'stop'>;

@Injectable()
export class SequentialRepository {
  async forEach<Item>(items: Iterable<Item>, step: Step<Item>): Promise<void> {
    const iterator = items[Symbol.iterator]();
    let index = 0;
    let exhausted = false;
    try {
      await lastValueFrom(
        defer(async () => {
          const next = iterator.next();
          if (next.done) {
            exhausted = true;
            return 'stop';
          }
          return step(next.value, index++);
        }).pipe(
          repeat(),
          takeWhile((result) => result !== 'stop'),
        ),
        { defaultValue: undefined },
      );
    } catch (error) {
      try {
        iterator.return?.();
      } catch {
        throw error;
      }
      throw error;
    }
    if (!exhausted) iterator.return?.();
  }

  repeat(
    times: number,
    step: (index: number) => Promise<void | 'stop'>,
  ): Promise<void> {
    function* indices() {
      for (let index = 0; index < times; index += 1) yield index;
    }
    return this.forEach(indices(), (index) => step(index));
  }
}
