import { Injectable } from '@nestjs/common';
import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
  Type,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { DomainException } from '../error-code';
import type { ErrorCode } from '../error-code';

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

export function multipartFileUploadInterceptor(
  options: MulterOptions,
  errors: MultipartUploadErrors,
): Type<NestInterceptor> {
  @Injectable()
  class MultipartUploadInterceptor extends FileInterceptor('file', options) {
    override async intercept(context: ExecutionContext, next: CallHandler) {
      try {
        return await super.intercept(context, next);
      } catch (error) {
        throw multipartUploadError(error, errors);
      }
    }
  }
  return MultipartUploadInterceptor;
}
