import { Inject, Injectable } from '@nestjs/common';
import {
  E2E_PROGRAM_AUTHORING_PORT,
  type E2eProgramAuthoringPort,
} from './e2e-program-authoring.adapter';
import {
  E2E_FAILURE_KINDS,
  type E2eFailureKind,
} from './e2e-program-authoring.types';
import { E2eAdapterError } from './e2e-program-authoring.adapter-error';

@Injectable()
export class E2eProgramAuthoringService {
  constructor(
    @Inject(E2E_PROGRAM_AUTHORING_PORT)
    private readonly adapter: E2eProgramAuthoringPort,
  ) {}

  async reset(): Promise<void> {
    await this.adapter.reset();
  }

  fixture(): Promise<
    import('./e2e-program-authoring.types').E2eProgramAuthoringGraph
  > {
    return this.adapter.fixture();
  }

  async adopt(
    programId: string,
    authorGithubId: bigint,
  ): Promise<import('./e2e-program-authoring.types').E2eProgramAuthoringGraph> {
    try {
      return await this.adapter.adopt(programId, authorGithubId);
    } catch (error) {
      if (error instanceof E2eAdapterError)
        throw new E2eControlError(error.status);
      throw error;
    }
  }

  async stateFor(programId: string) {
    return this.adapter.stateFor(programId);
  }

  preview() {
    return this.adapter.preview();
  }

  async application(mode: string): Promise<void> {
    if (mode !== 'NEW' && mode !== 'OWN') throw new E2eControlError(400);
    await this.adapter.createApplication(mode);
  }

  async approveAndRun(): Promise<void> {
    await this.adapter.approveAndRun();
  }

  failure(kind: string, count: unknown): void {
    if (
      !isFailureKind(kind) ||
      typeof count !== 'number' ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 3
    ) {
      throw new E2eControlError(400);
    }
    this.adapter.configureFailure(kind, count);
  }

  async exercise(kind: string): Promise<void> {
    if (!isFailureKind(kind)) throw new E2eControlError(400);
    await this.adapter.exercise(kind);
  }

  stalePreview(): Promise<void> {
    return this.adapter.stalePreview();
  }

  async crossTeamCurrentFile(): Promise<void> {
    try {
      await this.adapter.crossTeamCurrentFile();
    } catch (error) {
      if (error instanceof E2eAdapterError)
        throw new E2eControlError(error.status);
      throw error;
    }
  }
}

export class E2eControlError extends Error {
  override readonly name = 'E2eControlError';

  constructor(readonly status: number) {
    super('E2E control request was rejected.');
  }
}

function isFailureKind(value: string): value is E2eFailureKind {
  return E2E_FAILURE_KINDS.includes(value as E2eFailureKind);
}
