import { createHmac } from 'node:crypto';

export function computeJoinCodeDigest(
  joinCode: string,
  secret: string,
): string {
  return createHmac('sha256', secret).update(joinCode).digest('hex');
}
