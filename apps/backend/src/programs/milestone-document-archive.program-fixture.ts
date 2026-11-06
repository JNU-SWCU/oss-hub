import { RequirementFileNameService } from './files.service';
import {
  RequirementCollectionService,
  RequirementArchiveService,
} from './requirement-archive.service';
import { DownloadResponseService } from './download-response.service';
import { SubmissionStatus } from '@prisma/client';
import { Readable } from 'node:stream';
import type { ObjectStoragePort } from '../platform/object-storage.types';
import {
  type RequirementsRepository,
  type ArchiveProgram,
  type RequirementArchiveSubmission,
} from './requirements.repository';

export const now = new Date('2026-09-03T00:00:00Z');
export const fileBody = Buffer.from('synthetic retained image');
export const program: ArchiveProgram = {
  name: '예시 프로그램',
  milestones: ['계획', '결과'].map((name, index) => ({
    id: `milestone-${index}`,
    name,
    dueAt: new Date('2026-09-30T00:00:00Z'),
    requirements: [{ id: `document-${index}`, name: '보고서', required: true }],
  })),
};
export const teams = ['가팀', '나팀'].map((teamName, index) => ({
  teamId: `application-${index}`,
  teamName,
  applicantName: null,
  memberNicknames: [],
}));
export function submission(
  teamId: string,
  requirementId: string,
  status: SubmissionStatus = SubmissionStatus.SUBMITTED,
): RequirementArchiveSubmission {
  return {
    teamId,
    requirementId,
    status,
    submittedAt: now,
    content: {
      type: 'TEXT',
      text: `${teamId}-${requirementId} 최신 글`,
    },
    hasCurrentFileEvidence: false,
    file: null,
  };
}
export function fixture() {
  const programs = {
    findProgram: jest
      .fn<Promise<ArchiveProgram | null>, [string]>()
      .mockResolvedValue(program),
    findApprovedTeams: jest.fn().mockResolvedValue(teams),
  };
  const repository = {
    findSubmissionsForArchive: jest
      .fn()
      .mockResolvedValue([
        submission('application-0', 'document-0'),
        submission('application-0', 'document-1', SubmissionStatus.REJECTED),
        submission(
          'application-1',
          'document-1',
          SubmissionStatus.CHANGES_REQUESTED,
        ),
        submission('unapproved-application', 'document-0'),
        submission('application-0', 'other-program-document'),
      ]),
  };
  const storage = {
    get: jest
      .fn()
      .mockImplementation(() => Promise.resolve(Readable.from(fileBody))),
    put: jest.fn(),
    delete: jest.fn(),
  } satisfies ObjectStoragePort;
  return {
    programs,
    repository,
    storage,
    service: new RequirementArchiveService(
      repository as unknown as RequirementsRepository,
      storage,
      programs,
      new RequirementCollectionService({} as never),
      new RequirementFileNameService(),
      new DownloadResponseService(),
    ),
  };
}
