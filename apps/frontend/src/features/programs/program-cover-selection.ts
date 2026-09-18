export type ExternalProgramCover = {
  readonly sourceUrl: string;
  readonly imageUrl: string;
};

export type ProgramCoverSelection =
  File | ExternalProgramCover | null | undefined;

export function isExternalProgramCover(
  selection: ProgramCoverSelection,
): selection is ExternalProgramCover {
  return selection != null && 'imageUrl' in selection;
}
