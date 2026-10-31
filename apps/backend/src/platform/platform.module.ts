import { Global, Module } from '@nestjs/common';
import { AuditLogRepository } from './audit-log.repository';
import { AuditLogService } from './audit-log.service';
import { HealthController } from './health.controller';
import { HealthRepository } from './health.repository';
import { HealthService } from './health.service';
import { S3ObjectStorageClient } from './s3-object-storage.client';
import {
  ObjectStorageConfig,
  OBJECT_INVENTORY,
  OBJECT_STORAGE,
} from './object-storage.config';
import { PrismaService } from './prisma.service';
import {
  PROCESS_RUNTIME_CONFIG,
  RUNTIME_CONFIG,
} from './runtime-config-instance.config';
import { S3ObjectInventoryClient } from './s3-object-inventory.client';
import { AuditLogMetadataService } from './audit-log-metadata.service';

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
    { provide: OBJECT_STORAGE, useClass: S3ObjectStorageClient },
    { provide: OBJECT_INVENTORY, useClass: S3ObjectInventoryClient },
    HealthRepository,
    HealthService,
    AuditLogRepository,
    AuditLogMetadataService,
    AuditLogService,
  ],
  exports: [
    RUNTIME_CONFIG,
    PrismaService,
    OBJECT_STORAGE,
    OBJECT_INVENTORY,
    AuditLogMetadataService,
    AuditLogService,
  ],
})
export class PlatformModule {}
