import type { ProgramCategory } from '@prisma/client';

export type CreatedProgram = {
  readonly id: string;
  readonly category: ProgramCategory;
  readonly applicationTemplateKey: string;
  readonly applicationTemplateVersion: number;
  readonly endAt: Date;
};
