interface ProgramMailPreviewSourceResponseDto {
  readonly subject: string;
  readonly body: string;
  readonly applicantIds: readonly string[];
  readonly programName: string;
  readonly senderName: string;
  readonly recipientNames: readonly string[];
  readonly recipientCount: number;
  readonly renderedSubject: string;
  readonly footer: string;
  readonly previewedAt: string;
  readonly expiresAt: string;
  readonly previewVersion: string;
}

export class ProgramMailPreviewResponseDto {
  declare readonly subject: string;
  declare readonly body: string;
  declare readonly applicantIds: string[];
  declare readonly programName: string;
  declare readonly senderName: string;
  declare readonly recipientNames: string[];
  declare readonly recipientCount: number;
  declare readonly renderedSubject: string;
  declare readonly footer: string;
  declare readonly previewedAt: string;
  declare readonly expiresAt: string;
  declare readonly previewVersion: string;

  static from(
    value: ProgramMailPreviewSourceResponseDto,
  ): ProgramMailPreviewResponseDto {
    return {
      subject: value.subject,
      body: value.body,
      applicantIds: [...value.applicantIds],
      programName: value.programName,
      senderName: value.senderName,
      recipientNames: [...value.recipientNames],
      recipientCount: value.recipientCount,
      renderedSubject: value.renderedSubject,
      footer: value.footer,
      previewedAt: value.previewedAt,
      expiresAt: value.expiresAt,
      previewVersion: value.previewVersion,
    };
  }
}
