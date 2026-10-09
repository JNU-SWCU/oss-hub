import { Module } from '@nestjs/common';
import { RuntimeConfigModule } from '../runtime-config/runtime-config.module';
import { OBJECT_INVENTORY, OBJECT_STORAGE } from './domain/object-storage';
import { ObjectStorageConfig } from './object-storage.config';
import { S3ObjectInventory } from './gateway/s3-object-inventory';
import { S3ObjectStorage } from './gateway/s3-object.storage';

@Module({
  imports: [RuntimeConfigModule],
  providers: [
    ObjectStorageConfig,
    { provide: OBJECT_STORAGE, useClass: S3ObjectStorage },
    { provide: OBJECT_INVENTORY, useClass: S3ObjectInventory },
  ],
  exports: [OBJECT_STORAGE, OBJECT_INVENTORY],
})
export class StorageModule {}
