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
  // Given / When
  const page = buildMilestoneDocumentDeliveryPage(
    { documents, applications, submissions, dueAt },
    {
      filter: 'ALL',
      deliveryStatus: 'COMPLETE',
      page: 1,
      pageSize: 1,
    },
  );
  // Then
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
  // Given / When
  const page = buildMilestoneDocumentDeliveryPage(
    { documents, applications, submissions, dueAt },
    {
      filter: 'ALL',
      page: 1,
      pageSize: 10,
    },
  );
  // Then
  expect(page.rows.map((row) => row.deliveryStatus)).toEqual([
    'COMPLETE',
    'LATE',
    'MISSING',
  ]);
});

it('represents no required items separately instead of claiming completion', () => {
  // Given / When
  const page = buildMilestoneDocumentDeliveryPage(
    { documents: [], applications, submissions: [], dueAt },
    {
      filter: 'ALL',
      page: 1,
      pageSize: 10,
    },
  );
  // Then
  expect(page.deliveryCounts).toEqual({
    missing: 0,
    late: 0,
    complete: 0,
    noRequiredItems: 3,
  });
});
