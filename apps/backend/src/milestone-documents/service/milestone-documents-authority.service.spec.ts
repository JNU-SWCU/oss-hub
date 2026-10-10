import { AccountStatus, ReviewDecision } from '@prisma/client';
import { UsersAuthorityService } from '../../users/service/authority.service';
import type { ObjectStoragePort } from '../../storage/domain/object-storage';
import type { SubmissionFilesService } from '../../submissions/service/submission-files.service';
import { MilestoneDocumentArchiveService } from './milestone-document-archive.service';
import type { ProgramArchiveReader } from '../repository/milestone-document-archive.repository';
import { MilestoneDocumentCollectionService } from './milestone-document-collection.service';
import type { MilestoneDocumentCollectionReadRepository } from '../repository/milestone-document-collection-read.repository';
import { MilestoneDocumentFilesService } from './milestone-document-files.service';
import { MilestoneDocumentReviewsService } from './milestone-document-reviews.service';
import { MilestoneDocumentsService } from './milestone-documents.service';
import type { MilestoneDocumentsRepository } from '../repository/milestone-documents.repository';

const findActorByGithubId = jest.fn();
const authority = new UsersAuthorityService({ findActorByGithubId });
const repository = {} as MilestoneDocumentsRepository;
const storage = {
  put: jest.fn(),
  get: jest.fn(),
  delete: jest.fn(),
} satisfies ObjectStoragePort;
const documents = new MilestoneDocumentsService(repository, authority);
const files = new MilestoneDocumentFilesService(
  repository,
  storage,
  {} as SubmissionFilesService,
  authority,
);
const reviews = new MilestoneDocumentReviewsService(repository, authority);
const archives = new MilestoneDocumentArchiveService(
  repository,
  storage,
  {} as ProgramArchiveReader,
  authority,
);
const collection = new MilestoneDocumentCollectionService(
  {} as MilestoneDocumentCollectionReadRepository,
  authority,
);
const input = { name: '합성 서류', required: true, sortOrder: 1 };
const query = { filter: 'ALL', page: 1, pageSize: 20 } as const;
const operations: readonly (readonly [string, () => Promise<unknown>])[] = [
  ['create', () => documents.createDocument(77n, 'milestone', input)],
  [
    'update',
    () => documents.updateDocument(77n, 'milestone', 'document', input),
  ],
  ['reorder', () => documents.reorderDocuments(77n, 'milestone', ['document'])],
  ['delete', () => documents.deleteDocument(77n, 'milestone', 'document')],
  [
    'legacy collection',
    () => documents.collectForStaff(77n, 'milestone', query),
  ],
  [
    'delivery collection',
    () => collection.collectForStaff(77n, 'milestone', query),
  ],
  [
    'history',
    () =>
      documents.historyForStaff(77n, 'milestone', 'document', 'application', {
        cursor: null,
        limit: 20,
      }),
  ],
  [
    'template upload',
    () => files.uploadTemplate(77n, 'milestone', 'document', undefined),
  ],
  [
    'submission download',
    () =>
      files.downloadSubmissionFile(77n, 'milestone', 'document', 'application'),
  ],
  [
    'milestone archive',
    () =>
      archives.archiveForStaff(77n, 'milestone', {
        kind: 'ALL',
        grouping: 'TEAM',
      }),
  ],
  [
    'program archive',
    () => archives.archiveForProgramStaff(77n, 'program', { kind: 'PROGRAM' }),
  ],
  [
    'review',
    () =>
      reviews.review(77n, 'milestone', 'document', 'application', {
        decision: ReviewDecision.APPROVED,
        comment: null,
        resubmissionDueAt: null,
        expectedRevision: 1,
        expectedLatestReviewId: null,
      }),
  ],
];

beforeEach(() => {
  findActorByGithubId.mockReset();
  jest.clearAllMocks();
});

it.each(operations)(
  '%s enforces module authority before repository or storage access',
  async (_name, operation) => {
    for (const actor of [
      null,
      {
        id: 'student',
        hasStaffAccess: false,
        hasAdminAccess: false,
        accountStatus: AccountStatus.ACTIVE,
      },
      {
        id: 'inactive-staff',
        hasStaffAccess: true,
        hasAdminAccess: false,
        accountStatus: AccountStatus.DEACTIVATED,
      },
      {
        id: 'inactive-admin',
        hasStaffAccess: false,
        hasAdminAccess: true,
        accountStatus: AccountStatus.DEACTIVATED,
      },
    ]) {
      findActorByGithubId.mockResolvedValue(actor);
      await expect(operation()).rejects.toMatchObject({
        errorCode: {
          status: 403,
          code: 'MSD_001',
          message: '승인된 교직원 또는 관리자만 사용할 수 있습니다.',
        },
      });
      expect(findActorByGithubId).toHaveBeenLastCalledWith(77n);
    }
    expect(storage.put).not.toHaveBeenCalled();
    expect(storage.get).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  },
);
