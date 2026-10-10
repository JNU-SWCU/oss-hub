import { SubmissionStatus } from '@prisma/client';
import {
  milestoneDocumentArchiveFolderName,
  milestoneDocumentDownloadFileName,
  milestoneDocumentTextEntryFileName,
} from '../milestone-document-download-file-name';
import { readMilestoneDocumentSubmittedContent } from './milestone-document-content';

export type MilestoneDocumentArchiveGrouping = 'TEAM' | 'DOCUMENT';

export const MILESTONE_DOCUMENT_ARCHIVE_GROUPINGS: readonly MilestoneDocumentArchiveGrouping[] =
  ['TEAM', 'DOCUMENT'];

export type MilestoneDocumentArchiveLayout =
  MilestoneDocumentArchiveGrouping | 'FLAT';

export const MILESTONE_DOCUMENT_ARCHIVE_MANIFEST_FILE_NAME = '제출현황.csv';

export interface MilestoneDocumentArchiveDocument {
  readonly id: string;
  readonly name: string;
  readonly required: boolean;
}

export interface ArchiveProgram {
  readonly name: string;
  readonly milestones: readonly {
    readonly id: string;
    readonly name: string;
    readonly dueAt: Date;
    readonly documents: readonly MilestoneDocumentArchiveDocument[];
  }[];
}

export interface MilestoneDocumentArchiveTeam {
  readonly applicationId: string;
  readonly teamName: string;
  readonly applicantName: string | null;
  readonly memberNicknames: readonly string[];
}

export interface MilestoneDocumentArchiveSubmission {
  readonly applicationId: string;
  readonly milestoneDocumentId: string;
  readonly submittedAt: Date;
  readonly status: SubmissionStatus;

  readonly content: unknown;

  readonly hasCurrentFileEvidence: boolean;
  readonly file: {
    readonly storageKey: string;
    readonly originalFileName: string;
    readonly sizeBytes: number;
  } | null;
}

export type MilestoneDocumentArchiveEntry =
  | {
      readonly kind: 'STORED_FILE';
      readonly path: string;

      readonly modifiedAt: Date;
      readonly storageKey: string;
      readonly sizeBytes: number;
    }
  | {
      readonly kind: 'INLINE_TEXT';
      readonly path: string;
      readonly modifiedAt: Date;
      readonly body: string;
    };

export type MilestoneDocumentArchiveCellState =
  'NOT_SUBMITTED' | 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';

export type MilestoneDocumentArchiveOmission =
  | 'FILE_UNAVAILABLE'
  | 'CONTENT_UNAVAILABLE'
  | 'CONTENT_AND_FILE_UNAVAILABLE'
  | 'SUBMISSION_UNAVAILABLE';

export interface MilestoneDocumentArchiveCell {
  readonly documentId: string;
  readonly state: MilestoneDocumentArchiveCellState;
  readonly submittedAt: Date | null;

  readonly path: string | null;
  readonly omission: MilestoneDocumentArchiveOmission | null;
}

export interface MilestoneDocumentArchiveManifestRow {
  readonly team: MilestoneDocumentArchiveTeam;
  readonly cells: readonly MilestoneDocumentArchiveCell[];
}

export interface MilestoneDocumentArchivePlan {
  readonly entries: readonly MilestoneDocumentArchiveEntry[];
  readonly manifest: readonly MilestoneDocumentArchiveManifestRow[];

  readonly storedBytes: number;

  readonly inlineBytes: number;
}

export interface BuildMilestoneDocumentArchivePlanInput {
  readonly documents: readonly MilestoneDocumentArchiveDocument[];
  readonly teams: readonly MilestoneDocumentArchiveTeam[];
  readonly submissions: readonly MilestoneDocumentArchiveSubmission[];
  readonly layout: MilestoneDocumentArchiveLayout;
}

export function buildMilestoneDocumentArchivePlan(
  input: BuildMilestoneDocumentArchivePlanInput,
): MilestoneDocumentArchivePlan {
  const { documents, teams, submissions, layout } = input;

  const cellIndex = new Map<string, MilestoneDocumentArchiveSubmission>();
  for (const submission of submissions) {
    cellIndex.set(
      cellKey(submission.applicationId, submission.milestoneDocumentId),
      submission,
    );
  }

  const takenPaths = new Set<string>([
    collisionKey(MILESTONE_DOCUMENT_ARCHIVE_MANIFEST_FILE_NAME),
  ]);
  const entries: MilestoneDocumentArchiveEntry[] = [];
  let storedBytes = 0;
  let inlineBytes = 0;

  const manifest = teams.map((team) => ({
    team,
    cells: documents.map((document) => {
      const submission =
        cellIndex.get(cellKey(team.applicationId, document.id)) ?? null;
      if (submission === null) {
        return {
          documentId: document.id,
          state: 'NOT_SUBMITTED' as const,
          submittedAt: null,
          path: null,
          omission: null,
        };
      }

      const state = submittedState(submission.status);
      const cellEntries = buildEntries({ team, document, submission, layout });
      const omission = archiveOmission(submission);
      if (cellEntries.length === 0) {
        return {
          documentId: document.id,
          state,
          submittedAt: submission.submittedAt,
          path: null,
          omission: omission ?? ('SUBMISSION_UNAVAILABLE' as const),
        };
      }

      const paths = cellEntries.map((entry) => {
        const path = uniquePath(entry.path, takenPaths);
        const placed = { ...entry, path };
        entries.push(placed);
        if (placed.kind === 'STORED_FILE') storedBytes += placed.sizeBytes;
        else inlineBytes += Buffer.byteLength(placed.body, 'utf8');
        return path;
      });
      return {
        documentId: document.id,
        state,
        submittedAt: submission.submittedAt,
        path:
          omission === null
            ? paths.join(' · ')
            : `${paths.join(' · ')} · ${archiveOmissionLabel(omission)}`,
        omission,
      };
    }),
  }));

  return { entries, manifest, storedBytes, inlineBytes };
}

function cellKey(applicationId: string, documentId: string): string {
  return `${applicationId}::${documentId}`;
}

function submittedState(
  status: SubmissionStatus,
): MilestoneDocumentArchiveCellState {
  return status === SubmissionStatus.SUBMITTED ? 'PENDING' : status;
}

function archiveOmission(
  submission: MilestoneDocumentArchiveSubmission,
): MilestoneDocumentArchiveOmission | null {
  const contentUnavailable =
    submission.content !== null &&
    readMilestoneDocumentSubmittedContent(submission.content) === null;
  const fileUnavailable =
    submission.hasCurrentFileEvidence && submission.file === null;
  if (contentUnavailable && fileUnavailable)
    return 'CONTENT_AND_FILE_UNAVAILABLE';
  if (contentUnavailable) return 'CONTENT_UNAVAILABLE';
  if (fileUnavailable) return 'FILE_UNAVAILABLE';
  return null;
}

function archiveOmissionLabel(
  omission: MilestoneDocumentArchiveOmission,
): string {
  switch (omission) {
    case 'FILE_UNAVAILABLE':
      return '(첨부를 가져올 수 없음)';
    case 'CONTENT_UNAVAILABLE':
      return '(내용 없음)';
    case 'CONTENT_AND_FILE_UNAVAILABLE':
      return '(내용 없음 · 첨부를 가져올 수 없음)';
    case 'SUBMISSION_UNAVAILABLE':
      return '(제출 내용을 가져올 수 없음)';
  }
}

function buildEntries(input: {
  readonly team: MilestoneDocumentArchiveTeam;
  readonly document: MilestoneDocumentArchiveDocument;
  readonly submission: MilestoneDocumentArchiveSubmission;
  readonly layout: MilestoneDocumentArchiveLayout;
}): readonly MilestoneDocumentArchiveEntry[] {
  const { team, document, submission, layout } = input;

  const prefix =
    layout === 'FLAT'
      ? ''
      : `${archiveFolderPath(layout === 'TEAM' ? team.teamName : document.name)}/`;

  const entries: MilestoneDocumentArchiveEntry[] = [];
  if (submission.file !== null) {
    const fileName = milestoneDocumentDownloadFileName({
      teamName: team.teamName,
      documentName: document.name,
      originalFileName: submission.file.originalFileName,
    });
    entries.push({
      kind: 'STORED_FILE',
      path: `${prefix}${fileName}`,
      modifiedAt: submission.submittedAt,
      storageKey: submission.file.storageKey,
      sizeBytes: submission.file.sizeBytes,
    });
  }

  const content = readMilestoneDocumentSubmittedContent(submission.content);
  if (content !== null) {
    entries.push({
      kind: 'INLINE_TEXT',
      path: `${prefix}${milestoneDocumentTextEntryFileName({
        teamName: team.teamName,
        documentName: document.name,
      })}`,
      modifiedAt: submission.submittedAt,
      body: content.text,
    });
  }
  return entries;
}

function archiveFolderPath(name: string): string {
  const folder = milestoneDocumentArchiveFolderName(name);

  return collisionKey(folder) ===
    collisionKey(MILESTONE_DOCUMENT_ARCHIVE_MANIFEST_FILE_NAME)
    ? `${folder} (2)`
    : folder;
}

function uniquePath(path: string, taken: Set<string>): string {
  if (!taken.has(collisionKey(path))) {
    taken.add(collisionKey(path));
    return path;
  }
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');

  const hasExtension = dot > slash + 1;
  const stem = hasExtension ? path.slice(0, dot) : path;
  const extension = hasExtension ? path.slice(dot) : '';
  for (let ordinal = 2; ; ordinal += 1) {
    const candidate = `${stem} (${ordinal})${extension}`;
    if (!taken.has(collisionKey(candidate))) {
      taken.add(collisionKey(candidate));
      return candidate;
    }
  }
}

function collisionKey(path: string): string {
  return path.normalize('NFC').toLowerCase();
}
