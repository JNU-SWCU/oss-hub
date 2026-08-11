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
      status: 'practice',
    });

    // When
    const errors = await validate(query);

    // Then
    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('status');
  });

  it('accepts catalog status filters without practice', async () => {
    for (const status of [
      'all',
      'recruiting',
      'in_progress',
      'upcoming',
      'ended',
    ] as const) {
      const query = plainToInstance(ProgramListQueryRequestDto, { status });
      const errors = await validate(query);
      expect(errors).toHaveLength(0);
      expect(query.toQuery().status).toBe(status);
    }
  });

  it('omits sort/direction from toQuery when not given, preserving legacy order', async () => {
    // Given
    const query = plainToInstance(ProgramListQueryRequestDto, {});

    // When
    const errors = await validate(query);

    // Then
    expect(errors).toHaveLength(0);
    const result = query.toQuery();
    expect(result.sort).toBeUndefined();
    expect(result.direction).toBeUndefined();
  });

  it('accepts every documented sort key and direction', async () => {
    for (const sort of ['name', 'applicationPeriod', 'status'] as const) {
      for (const direction of ['asc', 'desc'] as const) {
        const query = plainToInstance(ProgramListQueryRequestDto, {
          sort,
          direction,
        });
        const errors = await validate(query);
        expect(errors).toHaveLength(0);
        expect(query.toQuery().sort).toBe(sort);
        expect(query.toQuery().direction).toBe(direction);
      }
    }
  });

  it('rejects unsupported sort and direction values', async () => {
    // Given
    const query = plainToInstance(ProgramListQueryRequestDto, {
      sort: 'popularity',
      direction: 'sideways',
    });

    // When
    const errors = await validate(query);

    // Then
    const properties = errors.map((error) => error.property).sort();
    expect(properties).toEqual(['direction', 'sort']);
  });
});
