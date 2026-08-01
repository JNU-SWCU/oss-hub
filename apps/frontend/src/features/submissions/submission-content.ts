import type { SubmissionFormInput } from './submission-form';
import type { CreateSubmissionContent, SubmissionFormData } from './types';

export function submissionContent(
  data: SubmissionFormData,
  input: SubmissionFormInput,
): CreateSubmissionContent | null {
  switch (data.milestone.submissionType) {
    case 'TEXT':
      return { type: 'TEXT', text: input.text.trim() };
    case 'REPOSITORY_RELEASE':
      return {
        type: 'REPOSITORY_RELEASE',
        releaseUrl: input.releaseUrl.trim(),
      };
    case 'FILE':
      return null;
    default: {
      const exhaustiveType: never = data.milestone.submissionType;
      return exhaustiveType;
    }
  }
}
