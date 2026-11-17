import type { RequirementSubmittedContent } from '../requirements.repository';

export class RequirementTextContentResponseDto {
  declare readonly text: string;

  static from(
    content: RequirementSubmittedContent,
  ): RequirementTextContentResponseDto {
    return { text: content.text };
  }
}
