export function programKey(programId: string) {
  return ['program', programId] as const;
}

export function programFeatureKey(
  programId: string,
  feature: string,
  ...parameters: readonly unknown[]
) {
  return [...programKey(programId), feature, ...parameters] as const;
}

export function featureKey(feature: string, ...parameters: readonly unknown[]) {
  return [feature, ...parameters] as const;
}

export function milestoneDocumentsKey(programId: string, milestoneId: string) {
  return programFeatureKey(programId, 'documents', milestoneId);
}
