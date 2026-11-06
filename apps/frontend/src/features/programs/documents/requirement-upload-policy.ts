import type { RequirementUploadPolicy } from './requirement-dto';

export function requirementUploadHint(policy: RequirementUploadPolicy): string {
  return `${policy.formatLabel} · 최대 ${policy.maxLabel}`;
}

export function requirementUploadRejection(
  file: File,
  policy: RequirementUploadPolicy,
): string | null {
  if (file.size > policy.maxBytes) {
    return `파일은 ${policy.maxLabel} 이하여야 합니다.`;
  }
  if (!acceptsFileName(file.name, policy.accept)) {
    return `${policy.formatLabel} 파일만 선택할 수 있습니다.`;
  }
  return null;
}

const REQUIREMENT_ARCHIVE_ERROR_CODES: ReadonlySet<string> = new Set([
  'MSD_037',
  'MSD_038',
  'MSD_039',
  'MSD_040',
  'MSD_041',
  'MSD_042',
  'MSD_043',
  'MSD_044',
]);

export function isRequirementArchiveErrorCode(code: string): boolean {
  return REQUIREMENT_ARCHIVE_ERROR_CODES.has(code);
}

function acceptsFileName(fileName: string, accept: string): boolean {
  const dot = fileName.lastIndexOf('.');

  const extension = dot > 0 ? fileName.slice(dot).toLowerCase() : '';
  return accept
    .split(',')
    .map((candidate) => candidate.trim().toLowerCase())
    .includes(extension);
}
