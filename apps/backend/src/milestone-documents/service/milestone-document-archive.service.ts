import { Inject, Injectable } from '@nestjs/common';
import { UsersAuthorityService } from '../../users/service/authority.service';
import type { Readable } from 'node:stream';
import { ZipFile } from 'yazl';
import { DomainException } from '../../common/error-code';
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../../storage/domain/object-storage';
import {
  buildMilestoneDocumentArchivePlan,
  MILESTONE_DOCUMENT_ARCHIVE_MANIFEST_FILE_NAME,
  type MilestoneDocumentArchiveDocument,
  type MilestoneDocumentArchivePlan,
} from '../domain/milestone-document-archive';
import { milestoneDocumentArchiveManifestCsv } from '../domain/milestone-document-archive-manifest-csv';
import { milestoneDocumentArchiveFolderName } from '../domain/milestone-document-download-file-name';
import {
  archiveDocumentsWithStageNames,
  archiveFileName,
} from '../domain/milestone-document-archive-names';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from '../domain/milestone-documents-error-code.enum';
import { MilestoneDocumentsRepository } from '../repository/milestone-documents.repository';
import {
  MilestoneDocumentArchiveRepository,
  type ProgramArchiveReader,
} from '../repository/milestone-document-archive.repository';
import type {
  MilestoneDocumentArchive,
  MilestoneDocumentArchiveScope,
  ProgramDocumentArchiveScope,
} from '../milestone-document-archive.types';

const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;

interface ZipFileFinalSize {
  end(
    options: { forceZip64Format: boolean; comment: string },
    onFinalSize: (finalSize: number) => void,
  ): void;
}

export class MilestoneDocumentArchiveEntryError extends Error {
  override readonly name = 'MilestoneDocumentArchiveEntryError';

  constructor(
    readonly storageKey: string,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}

@Injectable()
export class MilestoneDocumentArchiveService {
  constructor(
    private readonly repository: MilestoneDocumentsRepository,
    @Inject(OBJECT_STORAGE)
    private readonly storage: ObjectStoragePort,
    @Inject(MilestoneDocumentArchiveRepository)
    private readonly programs: ProgramArchiveReader,
    @Inject(UsersAuthorityService)
    private readonly authority: Pick<
      UsersAuthorityService,
      'assertActiveStaff'
    >,
  ) {}

  async archiveForProgramStaff(
    sessionGithubId: bigint,
    programId: string,
    scope: ProgramDocumentArchiveScope,
    now: Date = new Date(),
  ): Promise<MilestoneDocumentArchive> {
    await this.authority.assertActiveStaff(sessionGithubId, () =>
      this.error(MilestoneDocumentsErrorCode.STAFF_ONLY),
    );
    const program = await this.programs.findProgram(programId);
    if (program === null) {
      throw this.error(MilestoneDocumentsErrorCode.PROGRAM_NOT_FOUND);
    }
    const milestones =
      scope.kind === 'MILESTONE'
        ? program.milestones.filter((item) => item.id === scope.milestoneId)
        : program.milestones;
    if (scope.kind === 'MILESTONE' && milestones.length === 0) {
      throw this.error(MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND);
    }
    const teams = await this.programs.findApprovedTeams(
      programId,
      scope.kind === 'TEAM' ? scope.teamId : undefined,
    );
    if (scope.kind === 'TEAM' && teams.length === 0) {
      throw this.error(MilestoneDocumentsErrorCode.ARCHIVE_TEAM_NOT_FOUND);
    }
    const documents = archiveDocumentsWithStageNames(
      milestones,
      scope.kind === 'MILESTONE',
    );
    const submissions = await this.repository.findSubmissionsForArchive(
      documents.map((document) => document.id),
      now,
    );
    const plan = buildMilestoneDocumentArchivePlan({
      documents,
      teams,
      submissions,
      layout: scope.grouping ?? 'TEAM',
    });
    const milestone = milestones[0];
    const fileName =
      scope.kind === 'MILESTONE' && milestone !== undefined
        ? archiveFileName(milestone.name, milestone.dueAt)
        : `${milestoneDocumentArchiveFolderName(`${program.name}_${scope.kind === 'TEAM' ? teams[0]?.teamName : '전체'}`)}_현재제출.zip`;
    return this.createArchive(documents, plan, fileName, now);
  }

  async archiveForStaff(
    sessionGithubId: bigint,
    milestoneId: string,
    scope: MilestoneDocumentArchiveScope,
    now: Date = new Date(),
  ): Promise<MilestoneDocumentArchive> {
    await this.authority.assertActiveStaff(sessionGithubId, () =>
      this.error(MilestoneDocumentsErrorCode.STAFF_ONLY),
    );
    const milestone = await this.repository.findMilestone(milestoneId);
    if (milestone === null) {
      throw this.error(MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND);
    }

    const [allDocuments, teams] = await Promise.all([
      this.repository.findByMilestoneId(milestoneId),
      this.repository.findApprovedApplicationsForCollection(
        milestone.programId,
      ),
    ]);

    const documents =
      scope.kind === 'DOCUMENT'
        ? allDocuments.filter((document) => document.id === scope.documentId)
        : allDocuments;
    if (scope.kind === 'DOCUMENT' && documents.length === 0) {
      throw this.error(MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND);
    }

    const submissions = await this.repository.findSubmissionsForArchive(
      documents.map((document) => document.id),
      now,
    );

    const plan = buildMilestoneDocumentArchivePlan({
      documents,
      teams,
      submissions,
      layout: scope.kind === 'DOCUMENT' ? 'FLAT' : scope.grouping,
    });
    return this.createArchive(
      documents,
      plan,
      archiveFileName(
        scope.kind === 'DOCUMENT'
          ? (documents[0]?.name ?? milestone.name)
          : milestone.name,
        milestone.dueAt,
      ),
      now,
    );
  }

  private createArchive(
    documents: readonly MilestoneDocumentArchiveDocument[],
    plan: MilestoneDocumentArchivePlan,
    fileName: string,
    now: Date,
  ): MilestoneDocumentArchive {
    if (plan.storedBytes + plan.inlineBytes > MAX_ARCHIVE_BYTES) {
      throw this.error(MilestoneDocumentsErrorCode.ARCHIVE_TOO_LARGE);
    }

    const zip = new ZipFile();

    const output = zip.outputStream as Readable;

    zip.on('error', (error: unknown) => {
      output.destroy(error instanceof Error ? error : new Error(String(error)));
    });

    output.on('error', () => undefined);

    let activeBody: Readable | null = null;
    output.once('close', () => {
      activeBody?.destroy();
      activeBody = null;
    });

    zip.addBuffer(
      Buffer.from(
        milestoneDocumentArchiveManifestCsv({
          documents,
          rows: plan.manifest,
        }),
        'utf8',
      ),
      MILESTONE_DOCUMENT_ARCHIVE_MANIFEST_FILE_NAME,
      { mtime: now, compress: false },
    );

    for (const entry of plan.entries) {
      if (entry.kind === 'INLINE_TEXT') {
        zip.addBuffer(Buffer.from(entry.body, 'utf8'), entry.path, {
          mtime: entry.modifiedAt,
          compress: false,
        });
        continue;
      }

      zip.addReadStreamLazy(
        entry.path,
        { mtime: entry.modifiedAt, size: entry.sizeBytes, compress: false },
        (openStream) => {
          if (output.destroyed) {
            openStream(new Error('archive stream closed'), undefined as never);
            return;
          }
          this.storage.get(entry.storageKey).then(
            (body) => {
              if (output.destroyed) {
                body.destroy();
                openStream(
                  new Error('archive stream closed'),
                  undefined as never,
                );
                return;
              }

              body.once('error', (error: unknown) => {
                output.destroy(
                  new MilestoneDocumentArchiveEntryError(
                    entry.storageKey,
                    error,
                  ),
                );
              });
              activeBody = body;
              body.once('close', () => {
                if (activeBody === body) activeBody = null;
              });
              openStream(null, body);
            },

            (error: unknown) =>
              openStream(
                new MilestoneDocumentArchiveEntryError(entry.storageKey, error),
                undefined as never,
              ),
          );
        },
      );
    }

    let contentLength: number | null = null;
    (zip as unknown as ZipFileFinalSize).end(
      {
        forceZip64Format: needsZip64Eocd([
          MILESTONE_DOCUMENT_ARCHIVE_MANIFEST_FILE_NAME,
          ...plan.entries.map((entry) => entry.path),
        ]),
        comment: '',
      },
      (finalSize) => {
        contentLength = finalSize;
      },
    );

    return {
      body: output,
      fileName,
      contentType: 'application/zip',
      contentLength,
    };
  }

  private error(code: MilestoneDocumentsErrorCode): DomainException {
    return new DomainException(MILESTONE_DOCUMENTS_ERROR_CODES[code]);
  }
}

function needsZip64Eocd(paths: readonly string[]): boolean {
  const centralDirectoryBytes = paths.reduce(
    (total, path) => total + 46 + Buffer.byteLength(path, 'utf8') + 9,
    0,
  );
  return centralDirectoryBytes >= 0xffff;
}
