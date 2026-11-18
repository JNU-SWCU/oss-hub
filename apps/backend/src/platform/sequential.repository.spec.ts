import { SequentialRepository } from './sequential.repository';
import { EventEmitter, once } from 'node:events';

describe('SequentialRepository', () => {
  const sequential = new SequentialRepository();

  it('pulls the next item only after the preceding step completes', async () => {
    const gate = new EventEmitter();
    const entered = once(gate, 'entered');
    const release = once(gate, 'release');
    const events: string[] = [];
    function* items() {
      for (const item of ['first', 'second']) {
        events.push(`pull:${item}`);
        yield item;
      }
    }

    const run = sequential.forEach(items(), async (item, index) => {
      events.push(`step:${index}:${item}`);
      if (index === 0) {
        gate.emit('entered');
        await release;
      }
    });
    await entered;
    const pendingEvents = [...events];
    gate.emit('release');
    await run;

    expect(pendingEvents).toEqual(['pull:first', 'step:0:first']);
    expect(events).toEqual([
      'pull:first',
      'step:0:first',
      'pull:second',
      'step:1:second',
    ]);
  });

  it.each(['stop', 'error'] as const)(
    'closes a lazy iterable without pulling another item on %s',
    async (outcome) => {
      const events: string[] = [];
      const failure = new Error('step failed');
      function* items() {
        try {
          events.push('pull');
          yield 'first';
          events.push('unexpected pull');
          yield 'second';
        } finally {
          events.push('closed');
        }
      }

      const run = sequential.forEach(items(), () => {
        events.push('step');
        return outcome === 'error'
          ? Promise.reject(failure)
          : Promise.resolve('stop' as const);
      });
      if (outcome === 'error') {
        await expect(run).rejects.toBe(failure);
      } else {
        await run;
      }

      expect(events).toEqual(['pull', 'step', 'closed']);
    },
  );

  it('repeats with zero-based indices and stops before the remaining attempts', async () => {
    const indices: number[] = [];

    await sequential.repeat(4, (index) => {
      indices.push(index);
      return Promise.resolve(index === 1 ? 'stop' : undefined);
    });

    expect(indices).toEqual([0, 1]);
  });

  it('preserves the step failure when closing the iterator also fails', async () => {
    const failure = new Error('step failed');
    const items: Iterable<string> = {
      [Symbol.iterator]: () => ({
        next: () => ({ value: 'first', done: false }),
        return: () => {
          throw new Error('close failed');
        },
      }),
    };

    await expect(
      sequential.forEach(items, () => Promise.reject(failure)),
    ).rejects.toBe(failure);
  });
});
