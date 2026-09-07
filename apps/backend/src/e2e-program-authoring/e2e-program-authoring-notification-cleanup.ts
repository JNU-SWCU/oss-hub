import type { Prisma } from '@prisma/client';

const DEADLINE_PREFIXES = ['deadline-digest:', 'deadline-digest-staff:'];

export async function deleteE2eProgramDeadlineClaims(
  transaction: Prisma.TransactionClient,
  programId: string,
): Promise<void> {
  const candidates = await transaction.notification.findMany({
    where: {
      type: 'DEADLINE_DIGEST',
      OR: DEADLINE_PREFIXES.map((prefix) => ({
        idempotencyKey: { startsWith: prefix },
      })),
    },
    select: { id: true, userId: true, idempotencyKey: true },
  });
  const ids = candidates
    .filter(({ userId, idempotencyKey }) => {
      if (idempotencyKey === null) return false;
      return DEADLINE_PREFIXES.some((prefix) => {
        if (!idempotencyKey.startsWith(prefix)) return false;
        const date = idempotencyKey.slice(prefix.length, prefix.length + 10);
        return (
          /^\d{4}-\d{2}-\d{2}$/.test(date) &&
          idempotencyKey === `${prefix}${date}:${programId}:${userId}`
        );
      });
    })
    .map(({ id }) => id);
  if (ids.length > 0)
    await transaction.notification.deleteMany({ where: { id: { in: ids } } });
}
