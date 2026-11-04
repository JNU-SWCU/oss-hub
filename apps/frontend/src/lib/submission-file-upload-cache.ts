export class SubmissionFileUploadCache {
  private current: { readonly file: File; readonly fileId: string } | null =
    null;

  async resolve(
    file: File,
    upload: () => Promise<{ readonly fileId: string }>,
  ): Promise<string> {
    if (this.current?.file === file) return this.current.fileId;
    const uploaded = await upload();
    this.current = { file, fileId: uploaded.fileId };
    return uploaded.fileId;
  }

  discard(): void {
    this.current = null;
  }

  discardUnless(file: File | null): void {
    if (this.current?.file !== file) this.discard();
  }
}
