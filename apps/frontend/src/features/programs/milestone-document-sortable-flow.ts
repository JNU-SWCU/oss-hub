import type { MilestoneDocument } from './milestone-document-api';

export function orderMilestoneDocumentsByIds(
  documents: readonly MilestoneDocument[],
  documentIds: readonly string[] | null,
): readonly MilestoneDocument[] {
  if (documentIds === null) return documents;
  const byId = new Map(documents.map((document) => [document.id, document]));
  const ordered = documentIds.flatMap((id) => {
    const document = byId.get(id);
    return document === undefined ? [] : [document];
  });
  return ordered.length === documents.length ? ordered : documents;
}

export function milestoneDocumentPosition(
  documents: readonly MilestoneDocument[],
  documentId: string,
): number {
  return documents.findIndex((document) => document.id === documentId);
}
