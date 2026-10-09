import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  OBJECT_STORAGE,
  ObjectStorageError,
  type ObjectStoragePort,
} from '../../storage/domain/object-storage';
import { ProgramCoverRepository } from '../repository/program-cover.repository';

@Injectable()
export class ProgramCoverService {
  constructor(
    private readonly repository: ProgramCoverRepository,
    @Inject(OBJECT_STORAGE)
    private readonly storage: ObjectStoragePort,
  ) {}

  async read(programId: string, coverId: string) {
    const cover = await this.repository.findPublicCover(programId, coverId);
    if (cover === null)
      throw new NotFoundException('Program cover was not found.');
    try {
      return {
        body: await this.storage.get(cover.storageKey),
        contentType: cover.mimeType,
        size: cover.sizeBytes,
      };
    } catch (error) {
      if (!(error instanceof ObjectStorageError)) throw error;
      if (error.code === 'SUBMISSION_FILE_STORAGE_GET_NOT_FOUND') {
        throw new NotFoundException('Program cover was not found.');
      }
      throw new ServiceUnavailableException(
        'Program cover is temporarily unavailable.',
      );
    }
  }
}
