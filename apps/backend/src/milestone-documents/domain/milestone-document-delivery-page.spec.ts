import { buildMilestoneDocumentDeliveryPage } from './milestone-document-delivery-page';

const dueAt = new Date('2026-08-14T12:00:00Z');
const documents = [
  { id: 'required', required: true },
  { id: 'optional', required: false },
];
const applications = ['early', 'late', 'missing'].map((applicationId) => ({
  applicationId,
}));
const submissions = [
  {
    applicationId: 'early',
    milestoneDocumentId: 'required',
    firstSubmittedAt: new Date('2026-08-14T11:00:00Z'),
  },
  {
    applicationId: 'late',
    milestoneDocumentId: 'required',
    firstSubmittedAt: new Date('2026-08-14T12:00:00.001Z'),
  },
];

it('counts the whole approved population before status filtering and pagination', () => {
  const page = buildMilestoneDocumentDeliveryPage(
    { documents, applications, submissions, dueAt },
    {
      filter: 'ALL',
      deliveryStatus: 'COMPLETE',
      page: 1,
      pageSize: 1,
    },
  );

  expect(page.rows.map((row) => row.application.applicationId)).toEqual([
    'early',
  ]);
  expect(page.total).toBe(1);
  expect(page.deliveryCounts).toEqual({
    missing: 1,
    late: 1,
    complete: 1,
    noRequiredItems: 0,
  });
  expect(page.documentTotals[0]).toEqual({
    documentId: 'required',
    submitted: 2,
    total: 3,
  });
});

it('keeps review-independent first submission and optional omission out of missing', () => {
  const page = buildMilestoneDocumentDeliveryPage(
    { documents, applications, submissions, dueAt },
    {
      filter: 'ALL',
      page: 1,
      pageSize: 10,
    },
  );

  expect(page.rows.map((row) => row.deliveryStatus)).toEqual([
    'COMPLETE',
    'LATE',
    'MISSING',
  ]);
});

it('represents no required items separately instead of claiming completion', () => {
  const page = buildMilestoneDocumentDeliveryPage(
    { documents: [], applications, submissions: [], dueAt },
    {
      filter: 'ALL',
      page: 1,
      pageSize: 10,
    },
  );

  expect(page.deliveryCounts).toEqual({
    missing: 0,
    late: 0,
    complete: 0,
    noRequiredItems: 3,
  });
});

it('filters a selected document before paging without shrinking milestone totals', () => {
  const query = {
    filter: 'ALL',
    page: 2,
    pageSize: 1,
    document: { id: 'required', submissionState: 'SUBMITTED' },
  } as const;
  const page = buildMilestoneDocumentDeliveryPage(
    { documents, applications, submissions, dueAt },
    query,
  );
  expect(page.rows.map((row) => row.application.applicationId)).toEqual([
    'late',
  ]);
  expect(page.total).toBe(2);
  expect(page.documentTotals).toEqual([
    { documentId: 'required', submitted: 2, total: 3 },
    { documentId: 'optional', submitted: 0, total: 3 },
  ]);
  expect(page.filterCounts.all).toBe(3);
});

it('selects missing optional documents without declaring the teams incomplete', () => {
  const query = {
    filter: 'ALL',
    page: 1,
    pageSize: 20,
    deliveryStatus: 'COMPLETE',
    document: { id: 'optional', submissionState: 'MISSING' },
  } as const;
  const page = buildMilestoneDocumentDeliveryPage(
    { documents, applications, submissions, dueAt },
    query,
  );
  expect(page.rows.map((row) => row.application.applicationId)).toEqual([
    'early',
  ]);
  expect(page.rows[0]?.deliveryStatus).toBe('COMPLETE');
  expect(page.deliveryCounts.complete).toBe(1);
});

it('keeps whole-population totals when a document selection has no submitted teams', () => {
  const query = {
    filter: 'ALL',
    page: 1,
    pageSize: 20,
    document: { id: 'optional', submissionState: 'SUBMITTED' },
  } as const;
  const page = buildMilestoneDocumentDeliveryPage(
    { documents, applications, submissions, dueAt },
    query,
  );
  expect(page.rows).toEqual([]);
  expect(page.total).toBe(0);
  expect(page.documentTotals[1]).toEqual({
    documentId: 'optional',
    submitted: 0,
    total: 3,
  });
});
