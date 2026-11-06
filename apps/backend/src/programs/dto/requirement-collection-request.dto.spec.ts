import { RequirementCollectionService } from '../requirement-archive.service';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RequirementCollectionRequestDto } from './requirement-collection-request.dto';

const collectionService = Object.create(
  RequirementCollectionService.prototype,
) as RequirementCollectionService;

it('parses document and submission selectors while preserving existing pagination', async () => {
  const dto = plainToInstance(RequirementCollectionRequestDto, {
    page: '2',
    pageSize: '20',
    filter: 'ALL',
    documentId: 'synthetic-document',
    submissionState: 'MISSING',
  });
  expect(await validate(dto)).toEqual([]);
  expect(collectionService.collectionQueryFromRequest(dto)).toEqual({
    page: 2,
    pageSize: 20,
    filter: 'ALL',
    document: { id: 'synthetic-document', submissionState: 'MISSING' },
  });
});

it('defaults a selected document to all teams without changing old requests', async () => {
  const dto = plainToInstance(RequirementCollectionRequestDto, {
    documentId: 'synthetic-document',
  });
  expect(await validate(dto)).toEqual([]);
  expect(collectionService.collectionQueryFromRequest(dto).document).toEqual({
    id: 'synthetic-document',
    submissionState: 'ALL',
  });
  expect(
    collectionService.collectionQueryFromRequest(
      new RequirementCollectionRequestDto(),
    ),
  ).toEqual({
    page: 1,
    pageSize: 20,
    filter: 'ALL',
  });
});

it.each([
  { submissionState: 'MISSING' },
  { documentId: '', submissionState: 'SUBMITTED' },
  { documentId: ['one', 'two'], submissionState: 'MISSING' },
  { documentId: 'synthetic-document', submissionState: 'REJECTED' },
])('rejects an invalid document selector: %j', async (input) => {
  const dto = plainToInstance(RequirementCollectionRequestDto, input);
  expect(await validate(dto)).not.toHaveLength(0);
});
