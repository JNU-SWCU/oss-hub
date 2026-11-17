import type { RequirementSubmittedContent } from '../requirements.repository';

export class RequirementTextContentResponseDto {
  declare readonly type: RequirementSubmittedContent['type'];
  declare readonly text: string;

  static from(
    content: RequirementSubmittedContent,
  ): RequirementTextContentResponseDto {
    return { type: content.type, text: content.text };
  }
}
