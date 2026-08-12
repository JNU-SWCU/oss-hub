import { PrismaService } from '../prisma/prisma.service';

export function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve: () => resolve() };
}

export function pidCapturingPrisma(
  prisma: PrismaService,
  capture: (pid: number) => void,
): PrismaService {
  return new Proxy(prisma, {
    get(target, property, receiver) {
      if (property === '$transaction') {
        return <T>(
          operation: (client: PrismaService) => Promise<T>,
        ): Promise<T> =>
          prisma.$transaction(async (transaction) => {
            const [row] = await transaction.$queryRaw<
              readonly { readonly pid: number }[]
            >`SELECT pg_backend_pid()::int AS pid`;
            capture(row?.pid ?? 0);
            return operation(transaction as unknown as PrismaService);
          });
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function'
        ? (value as (...args: readonly unknown[]) => unknown).bind(target)
        : value;
    },
  });
}

export function backendPid(): {
  readonly pid: Promise<number>;
  readonly capture: (pid: number) => void;
} {
  let capture: (pid: number) => void = () => undefined;
  const pid = new Promise<number>((resolve) => {
    capture = resolve;
  });
  return { pid, capture: (value: number) => capture(value) };
}

export async function releaseAfterBlocked(
  prisma: PrismaService,
  waiterPid: Promise<number>,
  blockerPid: Promise<number>,
  release: { readonly resolve: () => void },
  operations: readonly Promise<unknown>[],
): Promise<void> {
  try {
    await waitUntilBlockedBy(prisma, await waiterPid, await blockerPid);
  } finally {
    release.resolve();
    await Promise.allSettled(operations);
  }
}

async function waitUntilBlockedBy(
  prisma: PrismaService,
  waiterPid: number,
  blockerPid: number,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await prisma.$queryRaw<
      readonly { readonly blocked: boolean }[]
    >`
      SELECT ${blockerPid}::int = ANY(pg_blocking_pids(${waiterPid}::int)) AS blocked
    `;
    if (row?.blocked === true) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `백엔드(${waiterPid})가 백엔드(${blockerPid})에 막힌 상태를 관측하지 못했다.`,
  );
}
