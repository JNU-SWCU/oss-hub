import { MODULE_METADATA } from '@nestjs/common/constants';
import { Readable } from 'node:stream';
import { e2eProgramAuthoringExternalPorts } from '../e2e-program-authoring/e2e-external-ports';
import { SUBMISSION_DASHBOARD_SUMMARY_PORT } from './submission-dashboard-summary.port';
import { SubmissionDashboardSummaryService } from './submission-dashboard-summary.service';
import { SubmissionFileCleanupFailuresController } from './submission-file-cleanup-failures.controller';
import { SubmissionFileCleanupFailuresService } from './submission-file-cleanup-failures.service';
import {
  SUBMISSION_FILE_STORAGE,
  type SubmissionFileStoragePort,
} from './submission-file-storage.port';
import {
  resolveSubmissionFileStorage,
  SubmissionsModule,
} from './submissions.module';

const incumbentStorage: SubmissionFileStoragePort = {
  put: (input) =>
    Promise.resolve({
      objectKey: input.objectKey ?? 'incumbent-key',
      originalName: input.originalName,
      contentLength: input.body.byteLength,
      contentType: input.contentType,
    }),
  get: () => Promise.resolve(Readable.from([])),
  delete: () => Promise.resolve(),
};

const getMetadataArray = (key: string): unknown[] => {
  const metadata = Reflect.getMetadata(key, SubmissionsModule) as unknown;
  expect(Array.isArray(metadata)).toBe(true);
  return Array.isArray(metadata) ? metadata : [];
};

describe('SubmissionsModule storage provider', () => {
  it('binds the storage token through a factory', () => {
    // Given
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);

    // When
    const storageProvider = providers.find(
      (provider) =>
        typeof provider === 'object' &&
        provider !== null &&
        'provide' in provider &&
        provider.provide === SUBMISSION_FILE_STORAGE,
    );

    // Then
    expect(storageProvider).toBeDefined();
    expect(
      typeof storageProvider === 'object' &&
        storageProvider !== null &&
        'useFactory' in storageProvider,
    ).toBe(true);
  });

  it('exports the dashboard summary read port without exporting the concrete service', () => {
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);
    const exports = getMetadataArray(MODULE_METADATA.EXPORTS);

    expect(providers).toEqual(
      expect.arrayContaining([
        SubmissionDashboardSummaryService,
        expect.objectContaining({
          provide: SUBMISSION_DASHBOARD_SUMMARY_PORT,
          useExisting: SubmissionDashboardSummaryService,
        }),
      ]),
    );
    expect(exports).toContain(SUBMISSION_DASHBOARD_SUMMARY_PORT);
    expect(exports).not.toContain(SubmissionDashboardSummaryService);
  });

  it('registers the operator-facing cleanup exhaustion read surface (#545)', () => {
    const controllers = getMetadataArray(MODULE_METADATA.CONTROLLERS);
    const providers = getMetadataArray(MODULE_METADATA.PROVIDERS);

    expect(controllers).toContain(SubmissionFileCleanupFailuresController);
    expect(providers).toContain(SubmissionFileCleanupFailuresService);
  });

  it.each(['development', 'test', 'production'] as const)(
    'keeps incumbent storage in %s without external test control',
    (nodeEnvironment) => {
      // Given
      e2eProgramAuthoringExternalPorts.reset();

      // When
      const storage = resolveSubmissionFileStorage(incumbentStorage, {
        NODE_ENV: nodeEnvironment,
      });

      // Then
      expect(storage).toBe(incumbentStorage);
    },
  );

  it('selects shared fake storage only for explicit test control', () => {
    // Given
    e2eProgramAuthoringExternalPorts.reset();

    // When
    const storage = resolveSubmissionFileStorage(incumbentStorage, {
      NODE_ENV: 'test',
      E2E_PROGRAM_AUTHORING_CONTROL: 'enabled',
    });

    // Then
    expect(storage).toBe(e2eProgramAuthoringExternalPorts.storage);
  });

  it('fails closed when production enables external test control', () => {
    expect(() =>
      resolveSubmissionFileStorage(incumbentStorage, {
        NODE_ENV: 'production',
        E2E_PROGRAM_AUTHORING_CONTROL: 'enabled',
      }),
    ).toThrow(/forbidden/);
  });
});
