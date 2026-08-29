import { MilestoneSubmissionType } from '@prisma/client';
import type { E2eProgramAuthoringGraph } from './e2e-program-authoring.types';
import { PrismaService } from '../prisma/prisma.service';
import { E2eAdapterError } from './e2e-program-authoring.adapter-error';

type E2eProgramAdoptionDocument = {
  readonly id: string;
  readonly name: string;
  readonly required: boolean;
};

type E2eProgramAdoptionMilestone = {
  readonly id: string;
  readonly name: string;
  readonly submissionType: MilestoneSubmissionType | null;
  readonly documents: readonly E2eProgramAdoptionDocument[];
};

export type E2eProgramAdoptionCandidate = {
  readonly id: string;
  readonly name: string;
  readonly createRequest: {
    readonly actor: { readonly githubId: bigint };
  } | null;
  readonly milestones: readonly E2eProgramAdoptionMilestone[];
};

export type E2eProgramAdoptionPredicates = {
  readonly exactProgramId: boolean;
  readonly exactProgramMarker: boolean;
  readonly authenticatedActor: boolean;
  readonly exactMilestoneCount: boolean;
  readonly requiredFileDocument: boolean;
};

export async function adoptE2eProgramGraph(
  prisma: PrismaService,
  programId: string,
  authorGithubId: bigint,
  prefix: string,
): Promise<E2eProgramAuthoringGraph> {
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: {
      id: true,
      name: true,
      createRequest: { select: { actor: { select: { githubId: true } } } },
      milestones: {
        select: {
          id: true,
          name: true,
          submissionType: true,
          documents: {
            select: {
              id: true,
              name: true,
              required: true,
            },
          },
        },
      },
    },
  });
  return adoptPersistedE2eProgramGraph(
    program,
    programId,
    authorGithubId,
    prefix,
  );
}

export function inspectE2eProgramAdoption(
  program: E2eProgramAdoptionCandidate | null,
  programId: string,
  authorGithubId: bigint,
  prefix: string,
): E2eProgramAdoptionPredicates {
  const required = requiredFileMilestone(program, prefix);
  return {
    exactProgramId: program?.id === programId,
    exactProgramMarker: program?.name === `${prefix}happy-program`,
    authenticatedActor:
      program?.createRequest?.actor.githubId === authorGithubId,
    exactMilestoneCount: program?.milestones.length === 2,
    requiredFileDocument: required !== undefined,
  };
}

export function adoptPersistedE2eProgramGraph(
  program: E2eProgramAdoptionCandidate | null,
  programId: string,
  authorGithubId: bigint,
  prefix: string,
): E2eProgramAuthoringGraph {
  const predicates = inspectE2eProgramAdoption(
    program,
    programId,
    authorGithubId,
    prefix,
  );
  if (!Object.values(predicates).every(Boolean)) throw new E2eAdapterError(404);
  const required = requiredFileMilestone(program, prefix);
  if (program === null || required === undefined)
    throw new E2eAdapterError(404);
  const document = required.documents[0];
  if (document === undefined) throw new E2eAdapterError(404);
  return {
    programId: program.id,
    milestoneId: required.id,
    documentId: document.id,
  };
}

function requiredFileMilestone(
  program: E2eProgramAdoptionCandidate | null,
  prefix: string,
): E2eProgramAdoptionMilestone | undefined {
  return program?.milestones.find(
    (milestone) =>
      milestone.name === `${prefix}required-milestone` &&
      milestone.submissionType === null &&
      milestone.documents.length === 1 &&
      milestone.documents[0]?.name === `${prefix}required-document` &&
      milestone.documents[0]?.required === true,
  );
}
