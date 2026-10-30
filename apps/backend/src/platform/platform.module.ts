import { Global, Module } from '@nestjs/common';
import { AuditLogRepository } from './audit-log.repository';
import { AuditLogService } from './audit-log.service';
import { HealthController } from './health.controller';
import { HealthRepository } from './health.repository';
import { HealthService } from './health.service';
import { S3ObjectStorage } from './object-storage.client';
import { ObjectStorageConfig } from './object-storage.config';
import { OBJECT_INVENTORY, OBJECT_STORAGE } from './object-storage.types';
import { PrismaService } from './prisma.service';
import {
  PROCESS_RUNTIME_CONFIG,
  RUNTIME_CONFIG,
} from './runtime-config-instance.config';
import { S3ObjectInventory } from './s3-object-inventory.client';

@Global()
@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: RUNTIME_CONFIG,
      useValue: PROCESS_RUNTIME_CONFIG,
    },
    PrismaService,
    ObjectStorageConfig,
    { provide: OBJECT_STORAGE, useClass: S3ObjectStorage },
    { provide: OBJECT_INVENTORY, useClass: S3ObjectInventory },
    HealthRepository,
    HealthService,
    AuditLogRepository,
    AuditLogService,
  ],
  exports: [
    RUNTIME_CONFIG,
    PrismaService,
    OBJECT_STORAGE,
    OBJECT_INVENTORY,
    AuditLogService,
  ],
})
export class PlatformModule {}
