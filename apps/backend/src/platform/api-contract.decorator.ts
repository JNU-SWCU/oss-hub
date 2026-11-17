import { applyDecorators } from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiProduces,
} from '@nestjs/swagger';

const BINARY = { type: 'string', format: 'binary' } as const;

export function ApiFileResponse(...mediaTypes: string[]): MethodDecorator {
  return applyDecorators(
    ApiProduces(...mediaTypes),
    ApiOkResponse({ schema: BINARY }),
  );
}

export function ApiFileUpload(...stringFields: string[]): MethodDecorator {
  return applyDecorators(
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        required: ['file', ...stringFields],
        properties: {
          file: BINARY,
          ...Object.fromEntries(
            stringFields.map((field) => [field, { type: 'string' }]),
          ),
        },
      },
    }),
  );
}
