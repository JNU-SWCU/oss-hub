import { BadRequestException, ValidationPipe, type Type } from '@nestjs/common';
import { CreateBoardPostRequestDto } from '../../src/programs/dto/create-board-post-request.dto';
import { UpdateBoardPostRequestDto } from '../../src/programs/dto/update-board-post-request.dto';

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

const payloads: ReadonlyArray<readonly [string, unknown]> = [
  ['valid', { title: 'Title', body: 'Body' }],
  ['valid at max lengths', { title: 't'.repeat(200), body: 'b'.repeat(10000) }],
  ['empty object', {}],
  ['empty strings', { title: '', body: '' }],
  ['non-string values', { title: 1, body: false }],
  ['null values', { title: null, body: null }],
  ['over max lengths', { title: 't'.repeat(201), body: 'b'.repeat(10001) }],
  ['unknown field', { title: 'Title', body: 'Body', pinned: true }],
];

async function outcome(metatype: Type<unknown>, payload: unknown) {
  try {
    const value: unknown = await pipe.transform(payload, {
      type: 'body',
      metatype,
    });
    return { ok: true, value };
  } catch (error) {
    if (error instanceof BadRequestException) {
      return { ok: false, response: error.getResponse() };
    }
    throw error;
  }
}

describe.each([
  ['CreateBoardPostRequestDto', CreateBoardPostRequestDto],
  ['UpdateBoardPostRequestDto', UpdateBoardPostRequestDto],
] as const)('%s validation parity', (_name, metatype) => {
  it.each(payloads)('%s', async (_case, payload) => {
    expect(JSON.stringify(await outcome(metatype, payload))).toMatchSnapshot();
  });
});
