import { Prisma } from '@prisma/client';

const programBrand: unique symbol = Symbol('ProgramLock');
const milestoneBrand: unique symbol = Symbol('MilestoneLock');
export type ProgramLock = Readonly<{ id: string; [programBrand]: true }>;
export type MilestoneLock = Readonly<{
  id: string;
  programId: string;
  [milestoneBrand]: true;
}>;
type State = {
  program?: ProgramLock;
  milestone?: MilestoneLock;
  documents?: boolean;
  rank?: number;
};
const states = new WeakMap<Prisma.TransactionClient, State>();
type Step =
  | { stage: 'program'; programId: string }
  | { stage: 'milestone'; milestoneId: string; after?: ProgramLock }
  | {
      stage: 'documents';
      after: MilestoneLock;
      documentKind: 'DOCUMENT' | 'ALL';
    };
class LockOrderError extends Error {
  override readonly name = 'LockOrderError';
  constructor() {
    super('Invalid program tree lock order.');
  }
}

export function lockProgramTree(
  tx: Prisma.TransactionClient,
  step: Extract<Step, { stage: 'program' }>,
): Promise<ProgramLock | null>;
export function lockProgramTree(
  tx: Prisma.TransactionClient,
  step: Extract<Step, { stage: 'milestone' }>,
): Promise<MilestoneLock | null>;
export function lockProgramTree(
  tx: Prisma.TransactionClient,
  step: Extract<Step, { stage: 'documents' }>,
): Promise<Readonly<{ documentIds: readonly string[] }>>;
export async function lockProgramTree(
  tx: Prisma.TransactionClient,
  step: Step,
): Promise<
  | ProgramLock
  | MilestoneLock
  | Readonly<{ documentIds: readonly string[] }>
  | null
> {
  const state = states.get(tx) ?? {};
  states.set(tx, state);
  if (step.stage === 'program') {
    if (state.rank !== undefined) throw new LockOrderError();
    state.rank = 1;
    const rows = await tx.$queryRaw<readonly { id: string }[]>(
      Prisma.sql`SELECT id FROM "Program" WHERE id = ${step.programId} FOR UPDATE`,
    );
    if (rows.length !== 1) return null;
    const witness: ProgramLock = Object.freeze({
      id: step.programId,
      [programBrand]: true as const,
    });
    state.program = witness;
    return witness;
  }
  if (step.stage === 'milestone') {
    if (
      (state.rank ?? 0) >= 2 ||
      step.after !== state.program ||
      (state.rank === 1 && !state.program)
    )
      throw new LockOrderError();
    state.rank = 2;
    const rows = await tx.$queryRaw<
      readonly { id: string; programId: string }[]
    >(
      Prisma.sql`SELECT id, "programId" FROM "Milestone" WHERE id = ${step.milestoneId} FOR UPDATE`,
    );
    const row = rows[0];
    if (!row) return null;
    const witness: MilestoneLock = Object.freeze({
      id: row.id,
      programId: row.programId,
      [milestoneBrand]: true as const,
    });
    state.milestone = witness;
    return witness;
  }
  if (state.documents || !state.milestone || step.after !== state.milestone)
    throw new LockOrderError();
  state.rank = 3;
  state.documents = true;
  const rows = await tx.$queryRaw<readonly { id: string }[]>(
    step.documentKind === 'ALL'
      ? Prisma.sql`
    SELECT "id" FROM "MilestoneDocument"
    WHERE "milestoneId" = ${step.after.id}
    ORDER BY "id" FOR UPDATE
  `
      : Prisma.sql`
    SELECT "id" FROM "MilestoneDocument"
    WHERE "milestoneId" = ${step.after.id}
      AND "kind" = ${step.documentKind}::"MilestoneDocumentKind"
    ORDER BY "id" FOR UPDATE
  `,
  );
  return { documentIds: rows.map((row) => row.id) };
}
