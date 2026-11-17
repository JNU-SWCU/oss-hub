import type { Requirement } from './requirement-dto';

export type RequirementFileKind = 'link' | 'image' | 'archive' | 'document';

const IMAGE_FILE_NAME = /\.(?:png|jpe?g|gif|webp|bmp|svg)$/i;
const ARCHIVE_FILE_NAME = /\.(?:zip|7z|rar|tar|gz|tgz)$/i;

export function requirementFileKind(
  document: Pick<Requirement, 'submissionType' | 'viewerSubmission'>,
): RequirementFileKind {
  const fileName = document.viewerSubmission?.currentFileName ?? null;
  if (fileName !== null && IMAGE_FILE_NAME.test(fileName)) return 'image';
  if (fileName !== null && ARCHIVE_FILE_NAME.test(fileName)) return 'archive';
  return document.submissionType === 'TEXT' ? 'link' : 'document';
}
