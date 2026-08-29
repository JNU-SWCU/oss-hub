import type {
  E2eProgramAuthoringPort,
  E2eProgramAuthoringState,
} from './e2e-program-authoring.adapter';
import { E2eAdapterError } from './e2e-program-authoring.adapter-error';
import {
  E2eControlError,
  E2eProgramAuthoringService,
} from './e2e-program-authoring.service';

const state: E2eProgramAuthoringState = {
  programs: 1,
  milestones: 1,
  documents: 1,
  applications: 1,
  teams: 1,
  repositoryJobs: 1,
  repositories: 1,
  notifications: 1,
  dryRunEnvelopes: 1,
  attachedFiles: 0,
  orphanRows: 0,
  orphanObjects: 0,
  mailContentHashes: [],
  storageContentHashes: [],
};

const preview = {
  previewedAt: '2026-08-20T00:00:00.000Z',
  expiresAt: '2026-08-20T00:10:00.000Z',
  previewVersion: 'a'.repeat(64),
  applicationCount: 1,
  milestoneCount: 1,
  recipientCount: 1,
  inactiveCount: 0,
  optedOutCount: 0,
  noEmailCount: 0,
};

function adapter(): jest.Mocked<E2eProgramAuthoringPort> {
  return {
    reset: jest.fn().mockResolvedValue(undefined),
    fixture: jest.fn().mockResolvedValue({
      programId: 'e2e:program-authoring:program',
      milestoneId: 'e2e:program-authoring:milestone',
      documentId: 'e2e:program-authoring:document',
    }),
    adopt: jest.fn().mockResolvedValue({
      programId: 'e2e:program-authoring:adopted',
      milestoneId: 'e2e:program-authoring:adopted-milestone',
      documentId: 'e2e:program-authoring:adopted-document',
    }),
    stateFor: jest.fn().mockResolvedValue(state),
    preview: jest.fn().mockResolvedValue(preview),
    send: jest.fn().mockResolvedValue(undefined),
    createApplication: jest.fn().mockResolvedValue(undefined),
    approve: jest.fn().mockResolvedValue(undefined),
    approveAndRun: jest.fn().mockResolvedValue(undefined),
    configureFailure: jest.fn(),
    exercise: jest.fn().mockResolvedValue(undefined),
    stalePreview: jest.fn().mockResolvedValue(undefined),
    crossTeamCurrentFile: jest.fn().mockResolvedValue(undefined),
  };
}

describe('E2eProgramAuthoringService', () => {
  it('returns state queried by the persistence adapter', async () => {
    const port = adapter();
    const service = new E2eProgramAuthoringService(port);

    await expect(
      service.stateFor('e2e:program-authoring:program'),
    ).resolves.toBe(state);
    expect(port.stateFor.mock.calls).toEqual([
      ['e2e:program-authoring:program'],
    ]);
  });

  it('creates the requested repository-mode application through the adapter', async () => {
    const port = adapter();
    const service = new E2eProgramAuthoringService(port);

    await service.application('OWN');

    expect(port.createApplication.mock.calls).toEqual([['OWN']]);
  });

  it('approves an application without sending a deadline digest', async () => {
    const port = adapter();
    const service = new E2eProgramAuthoringService(port);

    await service.approve();

    expect(port.approve.mock.calls).toEqual([[]]);
    expect(port.approveAndRun.mock.calls).toEqual([]);
  });

  it('previews eligibility through the frozen control adapter', async () => {
    const port = adapter();
    const service = new E2eProgramAuthoringService(port);

    await expect(service.preview()).resolves.toBe(preview);
    expect(port.preview.mock.calls).toEqual([[]]);
  });

  it('sends the accepted preview through the same frozen control adapter', async () => {
    const port = adapter();
    const service = new E2eProgramAuthoringService(port);

    await service.send(preview.previewedAt, preview.previewVersion);

    expect(port.send.mock.calls).toEqual([
      [
        {
          previewedAt: preview.previewedAt,
          previewVersion: preview.previewVersion,
        },
      ],
    ]);
  });

  it('binds an adopted UI-created graph to the authenticated author', async () => {
    const port = adapter();
    const service = new E2eProgramAuthoringService(port);

    await service.adopt('e2e:program-authoring:adopted', 8_100_004n);

    expect(port.adopt.mock.calls).toEqual([
      ['e2e:program-authoring:adopted', 8_100_004n],
    ]);
  });

  it('converts an adoption guard rejection to the generic control error', async () => {
    const port = adapter();
    port.adopt.mockRejectedValue(new E2eAdapterError(404));
    const service = new E2eProgramAuthoringService(port);

    const rejected = service.adopt(
      'e2e:program-authoring:untrusted-program',
      8_100_004n,
    );

    await expect(rejected).rejects.toMatchObject<Partial<E2eControlError>>({
      name: 'E2eControlError',
      status: 404,
      message: 'E2E control request was rejected.',
    });
  });

  it('queries state through the exact adopted program id', async () => {
    const port = adapter();
    const service = new E2eProgramAuthoringService(port);
    const graph = await service.adopt(
      'e2e:program-authoring:adopted',
      8_100_004n,
    );

    await service.stateFor(graph.programId);

    expect(port.stateFor.mock.calls).toEqual([[graph.programId]]);
  });

  it('converts a cross-team guard rejection to the generic control error', async () => {
    const port = adapter();
    port.crossTeamCurrentFile.mockRejectedValue(new E2eAdapterError(409));
    const service = new E2eProgramAuthoringService(port);

    const rejected = service.crossTeamCurrentFile();

    await expect(rejected).rejects.toMatchObject<Partial<E2eControlError>>({
      name: 'E2eControlError',
      status: 409,
      message: 'E2E control request was rejected.',
    });
  });

  it('configures the real adapter failure registry before exercising it', async () => {
    const port = adapter();
    const service = new E2eProgramAuthoringService(port);
    service.failure('github', 1);

    await service.exercise('github');

    expect(port.configureFailure.mock.calls).toEqual([['github', 1]]);
    expect(port.exercise.mock.calls).toEqual([['github']]);
  });
});
