import { PrismaClient } from '@prisma/client';
import { AuthSessionService } from '../../../../apps/backend/src/platform/auth-session.service';

function assertLocalVerificationDatabase(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (
    (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') ||
    (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') ||
    database !== 'oss_hub_verify'
  ) {
    throw new Error(
      'issue-session refuses this DATABASE_URL. It must be postgresql on 127.0.0.1 or localhost and the database oss_hub_verify.',
    );
  }
}

async function main(): Promise<void> {
  const userId = process.argv[2];
  const databaseUrl = process.env.DATABASE_URL;
  const sessionSecret = process.env.SESSION_SECRET;
  if (userId === undefined || userId === '') {
    throw new Error('a seeded user id is required');
  }
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('DATABASE_URL is required');
  }
  if (sessionSecret === undefined || sessionSecret === '') {
    throw new Error('SESSION_SECRET is required');
  }
  assertLocalVerificationDatabase(databaseUrl);
  const secret = new Uint8Array(Buffer.from(sessionSecret, 'base64url'));
  if (secret.byteLength < 32) {
    throw new Error('SESSION_SECRET must decode to at least 32 bytes');
  }

  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user === null) {
      throw new Error(`user ${userId} was not found`);
    }
    const sessions = new AuthSessionService();
    const token = await sessions.issueSessionToken(
      secret,
      user.githubId,
      user.sessionVersion,
      Math.floor(Date.now() / 1000),
    );
    process.stdout.write(`${sessions.sessionCookieName(false)}=${token}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
