import { RunDeadlineError } from './collection-inventory.error';

export class CollectionSyncDeadline {
  constructor(private readonly now: () => Date) {}

  async run<T>(operation: Promise<T>, deadline: number): Promise<T> {
    const remaining = deadline - this.now().getTime();
    if (remaining <= 0) throw new RunDeadlineError();
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new RunDeadlineError()), remaining);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
