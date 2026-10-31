import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { DomainException, type ErrorCode } from './error-code.error';

const LATIN1_MAX_CODE_POINT = 0xff;

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

export function normalizeMultipartFileName(fileName: string): string {
  if (
    [...fileName].some(
      (character) => character.codePointAt(0)! > LATIN1_MAX_CODE_POINT,
    )
  ) {
    return fileName.normalize('NFC');
  }

  try {
    return UTF8_DECODER.decode(Buffer.from(fileName, 'latin1')).normalize(
      'NFC',
    );
  } catch {
    return fileName.normalize('NFC');
  }
}

type MultipartUploadErrors = {
  readonly fileTooLarge: ErrorCode;
  readonly invalidUpload: ErrorCode;
};

export function multipartUploadError(
  error: unknown,
  errors: MultipartUploadErrors,
): unknown {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return new DomainException(errors.fileTooLarge);
    }
    if (
      [
        'LIMIT_FIELD_KEY',
        'LIMIT_FIELD_VALUE',
        'LIMIT_FIELD_COUNT',
        'LIMIT_FILE_COUNT',
        'LIMIT_PART_COUNT',
        'LIMIT_UNEXPECTED_FILE',
      ].includes(String(error.code))
    ) {
      return new DomainException(errors.invalidUpload);
    }
  }
  return error;
}

export class MultipartFileUploadInterceptor implements NestInterceptor {
  private readonly upload: NestInterceptor;

  constructor(
    options: MulterOptions,
    private readonly errors: MultipartUploadErrors,
  ) {
    this.upload = new (FileInterceptor('file', options))();
  }

  async intercept(context: ExecutionContext, next: CallHandler) {
    try {
      return await this.upload.intercept(context, next);
    } catch (error) {
      throw multipartUploadError(error, this.errors);
    }
  }
}
