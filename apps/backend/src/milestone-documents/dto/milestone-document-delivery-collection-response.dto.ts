import type { DocumentDeliveryStatus } from '../../submissions/document-delivery-status';
import type {
  MilestoneDocumentCollectionResponseDto,
  MilestoneDocumentCollectionRowResponseDto,
} from './milestone-document-collection-response.dto';

export interface MilestoneDocumentDeliveryCollectionResponseDto extends Omit<
  MilestoneDocumentCollectionResponseDto,
  'rows'
> {
  readonly rows: readonly (MilestoneDocumentCollectionRowResponseDto & {
    readonly deliveryStatus: DocumentDeliveryStatus;
  })[];
  readonly deliveryCounts: {
    readonly missing: number;
    readonly late: number;
    readonly complete: number;
    readonly noRequiredItems: number;
  };
}
