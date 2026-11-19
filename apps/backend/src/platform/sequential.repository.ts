import { Injectable } from '@nestjs/common';

type Step<Item> = (item: Item, index: number) => Promise<void | 'stop'>;

@Injectable()
export class SequentialRepository {
  async *items<Item>(items: Iterable<Item>): AsyncGenerator<Awaited<Item>> {
    for (const item of this.closeOnPullFailure(items))
      yield Promise.resolve(item);
  }

  async forEach<Item>(items: Iterable<Item>, step: Step<Item>): Promise<void> {
    let index = 0;
    const source = this.closeOnPullFailure(items);
    for await (const { item } of this.items(wrapItems())) {
      if ((await step(item, index++)) === 'stop') break;
    }

    function* wrapItems() {
      for (const item of source) yield { item };
    }
  }

  private *closeOnPullFailure<Item>(items: Iterable<Item>): Generator<Item> {
    const iterator = items[Symbol.iterator]();
    let exhausted = false;
    try {
      for (;;) {
        const next = iterator.next();
        if (next.done) {
          exhausted = true;
          return;
        }
        yield next.value;
      }
    } catch (error) {
      exhausted = true;
      try {
        iterator.return?.();
      } catch {
        throw error;
      }
      throw error;
    } finally {
      if (!exhausted) iterator.return?.();
    }
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
