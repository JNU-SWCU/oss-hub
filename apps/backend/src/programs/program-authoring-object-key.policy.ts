import { randomUUID } from 'node:crypto';

export function createProgramAuthoringObjectKey(): string {
  return `program-authoring/${randomUUID()}`;
}
