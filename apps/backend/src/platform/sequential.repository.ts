import { Injectable } from '@nestjs/common';

type Step<Item> = (item: Item, index: number) => Promise<void | 'stop'>;

@Injectable()
export class SequentialRepository {
  async forEach<Item>(items: Iterable<Item>, step: Step<Item>): Promise<void> {
    let index = 0;
    for (const item of items) {
      if ((await step(item, index)) === 'stop') return;
      index += 1;
    }
  }

  async repeat(
    times: number,
    step: (index: number) => Promise<void | 'stop'>,
  ): Promise<void> {
    for (let index = 0; index < times; index += 1) {
      if ((await step(index)) === 'stop') return;
    }
  }
}
