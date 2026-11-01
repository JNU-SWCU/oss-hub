import { DomainException } from './error-code.error';
import { MultipartFileUploadInterceptor } from './multipart-file-upload.interceptor';

const errors = {
  fileTooLarge: { code: 'SIZE_LIMIT', status: 413, message: 'Size exceeded.' },
  invalidUpload: {
    code: 'INVALID_PART',
    status: 400,
    message: 'Invalid part.',
  },
};

const interceptor = new MultipartFileUploadInterceptor({}, errors);

it('maps the file size failure to the consumer error contract', () => {
  expect(interceptor.uploadError({ code: 'LIMIT_FILE_SIZE' })).toEqual(
    new DomainException(errors.fileTooLarge),
  );
});

it.each([
  'LIMIT_FIELD_KEY',
  'LIMIT_FIELD_VALUE',
  'LIMIT_FIELD_COUNT',
  'LIMIT_FILE_COUNT',
  'LIMIT_PART_COUNT',
  'LIMIT_UNEXPECTED_FILE',
])('maps %s to the consumer invalid-upload contract', (code) => {
  expect(interceptor.uploadError({ code })).toEqual(
    new DomainException(errors.invalidUpload),
  );
});

it.each([null, 'error', new Error('storage'), { code: 'UNRECOGNIZED' }])(
  'preserves an unrelated thrown value: %p',
  (error) => {
    expect(interceptor.uploadError(error)).toBe(error);
  },
);
