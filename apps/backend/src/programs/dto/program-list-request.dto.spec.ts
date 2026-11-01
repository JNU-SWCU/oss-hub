import { ProgramsService } from '../programs.service';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProgramListRequestDto } from './program-list-request.dto';

const programsService = Object.create(
  ProgramsService.prototype,
) as ProgramsService;

describe('ProgramListRequestDto', () => {
  it('uses the first page and a bounded default page size when query is empty', async () => {
    const query = plainToInstance(ProgramListRequestDto, {});

    const errors = await validate(query);

    expect(errors).toHaveLength(0);
    expect(programsService.listQueryFromRequest(query)).toEqual({
      page: 1,
      pageSize: 20,
      search: '',
      status: 'all',
    });
  });

  it('rejects page sizes above the public endpoint maximum', async () => {
    const query = plainToInstance(ProgramListRequestDto, {
      page: '1',
      pageSize: '101',
    });

    const errors = await validate(query);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('pageSize');
  });

  it('rejects unsupported recruitment status values', async () => {
    const query = plainToInstance(ProgramListRequestDto, {
      status: 'practice',
    });

    const errors = await validate(query);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('status');
  });

  it('accepts catalog status filters without practice', async () => {
    for (const status of [
      'all',
      'current',
      'recruiting',
      'in_progress',
      'upcoming',
      'ended',
    ] as const) {
      const query = plainToInstance(ProgramListRequestDto, { status });
      const errors = await validate(query);
      expect(errors).toHaveLength(0);
      expect(programsService.listQueryFromRequest(query).status).toBe(status);
    }
  });

  it('omits sort/direction from toQuery when not given, preserving legacy order', async () => {
    const query = plainToInstance(ProgramListRequestDto, {});

    const errors = await validate(query);

    expect(errors).toHaveLength(0);
    const result = programsService.listQueryFromRequest(query);
    expect(result.sort).toBeUndefined();
    expect(result.direction).toBeUndefined();
  });

  it.each([2000, 2027, 2100])('accepts year %i as an integer', async (year) => {
    const query = plainToInstance(ProgramListRequestDto, {
      year: String(year),
      status: 'current',
    });

    expect(await validate(query)).toHaveLength(0);
    expect(programsService.listQueryFromRequest(query)).toMatchObject({
      year,
      status: 'current',
    });
  });

  it.each(['1999', '2101', '2026.5', 'invalid', ''])(
    'rejects invalid year %s',
    async (year) => {
      const query = plainToInstance(ProgramListRequestDto, { year });

      const errors = await validate(query);

      expect(errors.map((error) => error.property)).toEqual(['year']);
    },
  );

  it('accepts every documented sort key and direction', async () => {
    for (const sort of ['name', 'applicationPeriod', 'status'] as const) {
      for (const direction of ['asc', 'desc'] as const) {
        const query = plainToInstance(ProgramListRequestDto, {
          sort,
          direction,
        });
        const errors = await validate(query);
        expect(errors).toHaveLength(0);
        expect(programsService.listQueryFromRequest(query).sort).toBe(sort);
        expect(programsService.listQueryFromRequest(query).direction).toBe(
          direction,
        );
      }
    }
  });

  it('rejects unsupported sort and direction values', async () => {
    const query = plainToInstance(ProgramListRequestDto, {
      sort: 'popularity',
      direction: 'sideways',
    });

    const errors = await validate(query);

    const properties = errors.map((error) => error.property).sort();
    expect(properties).toEqual(['direction', 'sort']);
  });
});
