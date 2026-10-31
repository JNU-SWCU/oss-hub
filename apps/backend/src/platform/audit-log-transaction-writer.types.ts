import type { PrismaService } from './prisma.service';

export type AuditLogTransactionWriter = Pick<PrismaService, 'auditLog'>;
