export type ProgramDocumentArchiveScope =
  | { readonly kind: 'PROGRAM' }
  | { readonly kind: 'MILESTONE'; readonly milestoneId: string }
  | { readonly kind: 'TEAM'; readonly teamId: string };

export type ProgramDocumentArchiveGrouping = 'TEAM' | 'DOCUMENT';
