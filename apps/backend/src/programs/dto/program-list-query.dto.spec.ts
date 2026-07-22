import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProgramListQueryRequestDto } from './program-list-query.dto';

describe('ProgramListQueryRequestDto', () => {
  it('uses the first page and a bounded default page size when query is empty', async () => {
    // Given
    const query = plainToInstance(ProgramListQueryRequestDto, {});

    // When
    const errors = await validate(query);

    // Then
    expect(errors).toHaveLength(0);
    expect(query.toQuery()).toEqual({
      page: 1,
      pageSize: 20,
      search: '',
      status: 'all',
    });
  });

  it('rejects page sizes above the public endpoint maximum', async () => {
    // Given
    const query = plainToInstance(ProgramListQueryRequestDto, {
      page: '1',
      pageSize: '101',
    });

    // When
    const errors = await validate(query);

    // Then
    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('pageSize');
  });

  it('rejects unsupported recruitment status values', async () => {
    // Given
    const query = plainToInstance(ProgramListQueryRequestDto, {
      status: 'scheduled',
    });

    // When
    const errors = await validate(query);

    // Then
    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('status');
  });
});
