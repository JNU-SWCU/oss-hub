import { Inject, Injectable } from '@nestjs/common';
import { UsersAuthorityService } from '../../users/authority.service';
import { DomainException } from '../../platform/error-code.error';
import type { MilestoneDocumentDeliveryCollectionResult } from '../domain/milestone-document-result';
import { MilestoneDocumentCollectionReadRepository } from '../repository/milestone-document-collection-read.repository';
import {
  buildMilestoneDocumentDeliveryPage,
  type MilestoneDocumentDeliveryQuery,
} from '../domain/milestone-document-delivery-page';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from '../domain/milestone-documents-error-code.enum';

@Injectable()
export class MilestoneDocumentCollectionService {
  constructor(
    private readonly repository: MilestoneDocumentCollectionReadRepository,
    @Inject(UsersAuthorityService)
    private readonly authority: Pick<
      UsersAuthorityService,
      'assertActiveStaff'
    >,
  ) {}

  async collectForStaff(
    sessionGithubId: bigint,
    milestoneId: string,
    query: MilestoneDocumentDeliveryQuery,
    now = new Date(),
  ): Promise<MilestoneDocumentDeliveryCollectionResult> {
    await this.authority.assertActiveStaff(
      sessionGithubId,
      () =>
        new DomainException(
          MILESTONE_DOCUMENTS_ERROR_CODES[
            MilestoneDocumentsErrorCode.STAFF_ONLY
          ],
        ),
    );
    return this.repository.withSnapshot(async (store) => {
      const milestone = await store.findMilestone(milestoneId);
      if (milestone === null)
        throw new DomainException(
          MILESTONE_DOCUMENTS_ERROR_CODES[
            MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND
          ],
        );
      const [documents, applications] = await Promise.all([
        store.findDocuments(milestoneId),
        store.findApplications(milestone.programId),
      ]);
      if (
        query.document !== undefined &&
        !documents.some((document) => document.id === query.document?.id)
      )
        throw new DomainException(
          MILESTONE_DOCUMENTS_ERROR_CODES[
            MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND
          ],
        );
      const documentIds = documents.map((document) => document.id);
      const coordinates = await store.findCoordinates(
        documentIds,
        applications.map((application) => application.applicationId),
      );
      const page = buildMilestoneDocumentDeliveryPage(
        {
          documents,
          applications,
          submissions: coordinates,
          dueAt: milestone.dueAt,
        },
        query,
      );
      const details = await store.findDetails(
        documentIds,
        page.rows.map((row) => row.application.applicationId),
        now,
      );
      const detailByCell = new Map(
        details.map((submission) => [
          `${submission.applicationId}::${submission.milestoneDocumentId}`,
          submission,
        ]),
      );
      return {
        milestone,
        documents,
        ...page,
        rows: page.rows.map((row) => ({
          application: row.application,
          deliveryStatus: row.deliveryStatus,
          cells: documents.map(
            (document) =>
              detailByCell.get(
                `${row.application.applicationId}::${document.id}`,
              ) ?? null,
          ),
        })),
      };
    });
  }
}
