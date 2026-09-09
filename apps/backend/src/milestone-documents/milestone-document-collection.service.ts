import { Injectable } from '@nestjs/common';
import { DomainException } from '../common/error-code';
import { MilestoneDocumentCollectionResponseDto } from './dto/milestone-document-collection-response.dto';
import type { MilestoneDocumentDeliveryCollectionResponseDto } from './dto/milestone-document-delivery-collection-response.dto';
import { MilestoneDocumentCollectionReadRepository } from './milestone-document-collection-read.repository';
import {
  buildMilestoneDocumentDeliveryPage,
  type MilestoneDocumentDeliveryQuery,
} from './milestone-document-delivery-page';
import {
  MILESTONE_DOCUMENTS_ERROR_CODES,
  MilestoneDocumentsErrorCode,
} from './milestone-documents-error-code.enum';

@Injectable()
export class MilestoneDocumentCollectionService {
  constructor(
    private readonly repository: MilestoneDocumentCollectionReadRepository,
  ) {}

  collectForStaff(
    milestoneId: string,
    query: MilestoneDocumentDeliveryQuery,
    now = new Date(),
  ): Promise<MilestoneDocumentDeliveryCollectionResponseDto> {
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
      const response = MilestoneDocumentCollectionResponseDto.from(
        milestone,
        documents,
        {
          ...page,
          rows: page.rows.map((row) => ({
            application: row.application,
            cells: documents.map(
              (document) =>
                detailByCell.get(
                  `${row.application.applicationId}::${document.id}`,
                ) ?? null,
            ),
          })),
        },
      );
      return {
        ...response,
        deliveryCounts: page.deliveryCounts,
        rows: response.rows.map((row, index) => {
          const coordinateRow = page.rows[index];
          if (coordinateRow === undefined)
            throw new Error('Collection row mapping lost its source');
          return { ...row, deliveryStatus: coordinateRow.deliveryStatus };
        }),
      };
    });
  }
}
