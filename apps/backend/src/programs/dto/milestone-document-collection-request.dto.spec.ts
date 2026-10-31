import { MilestoneDocumentCollectionService } from '../milestone-document-collection.service';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MilestoneDocumentCollectionRequestDto } from './milestone-document-collection-request.dto';

const collectionService = Object.create(
  MilestoneDocumentCollectionService.prototype,
) as MilestoneDocumentCollectionService;

it('parses document and submission selectors while preserving existing pagination', async () => {
  const dto = plainToInstance(MilestoneDocumentCollectionRequestDto, {
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
  const dto = plainToInstance(MilestoneDocumentCollectionRequestDto, {
    documentId: 'synthetic-document',
  });
  expect(await validate(dto)).toEqual([]);
  expect(collectionService.collectionQueryFromRequest(dto).document).toEqual({
    id: 'synthetic-document',
    submissionState: 'ALL',
  });
  expect(
    collectionService.collectionQueryFromRequest(
      new MilestoneDocumentCollectionRequestDto(),
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
  const dto = plainToInstance(MilestoneDocumentCollectionRequestDto, input);
  expect(await validate(dto)).not.toHaveLength(0);
});
