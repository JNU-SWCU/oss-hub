import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { GithubOperationsError } from '../github/github-app.error';
import { SubmissionFileStorageError } from '../submissions/submission-file-storage.port';
import {
  E2E_EXTERNAL_FAILURE_OPERATIONS,
  E2eExternalPortFailure,
  e2eProgramAuthoringExternalPorts,
} from './e2e-external-ports';

const contentHash = (value: Buffer | string): string =>
  createHash('sha256').update(value).digest('hex');

describe('e2eProgramAuthoringExternalPorts', () => {
  beforeEach(() => {
    e2eProgramAuthoringExternalPorts.reset();
    e2eProgramAuthoringExternalPorts.github.configureOrganization('e2e-org');
  });

  it('creates deterministic private repositories and resolves configured and external visibility paths', async () => {
    // Given
    const github = e2eProgramAuthoringExternalPorts.github;

    // When
    const created = await github.createRepository(
      'new-repository',
      'description',
    );
    const configuredPrivate = await github.findRepository('owned-private');
    const configuredPublic = await github.findRepository('owned-public');
    const externalPublic = await github.findPublicRepository(
      'external-owner',
      'public-repository',
    );
    const externalPrivate = await github.findPublicRepository(
      'external-owner',
      'private-repository',
    );
    const externalInaccessible = await github.findPublicRepository(
      'external-owner',
      'inaccessible-repository',
    );

    // Then
    expect(created).toMatchObject({
      name: 'new-repository',
      visibility: 'PRIVATE',
      url: 'https://github.com/e2e-org/new-repository',
    });
    expect(configuredPrivate?.visibility).toBe('PRIVATE');
    expect(configuredPublic?.visibility).toBe('PUBLIC');
    expect(externalPublic?.visibility).toBe('PUBLIC');
    expect(externalPrivate).toBeNull();
    expect(externalInaccessible).toBeNull();
  });

  it('keeps collaborator invitation outcomes idempotent', async () => {
    // Given
    const github = e2eProgramAuthoringExternalPorts.github;
    await github.createRepository('new-repository', 'description');

    // When
    const first = await github.ensureCollaborator(
      'new-repository',
      'synthetic-user',
    );
    const second = await github.ensureCollaborator(
      'new-repository',
      'synthetic-user',
    );

    // Then
    expect(first).toBe('PENDING');
    expect(second).toBe('PENDING');
  });

  it('stores deterministic bytes while exposing only sanitized mail and storage captures', async () => {
    // Given
    const body = Buffer.from('deterministic-content');

    // When
    const stored = await e2eProgramAuthoringExternalPorts.storage.put({
      body,
      contentType: 'text/plain',
      originalName: 'fixture.txt',
    });
    const received = await buffer(
      await e2eProgramAuthoringExternalPorts.storage.get(stored.objectKey),
    );
    await e2eProgramAuthoringExternalPorts.mail.send({
      to: 'synthetic-recipient@example.test',
      subject: 'digest',
      body: 'deterministic-mail',
    });
    const capture = e2eProgramAuthoringExternalPorts.capture();

    // Then
    expect(stored).toMatchObject({
      contentLength: body.byteLength,
      contentType: 'text/plain',
      originalName: 'fixture.txt',
    });
    expect(received).toEqual(body);
    expect(capture).toEqual({
      mail: {
        envelopeCount: 1,
        contentHashes: [contentHash('digest\ndeterministic-mail')],
      },
      storage: {
        objectCount: 1,
        contentHashes: [contentHash(body)],
        objectKeys: [stored.objectKey],
      },
    });
    expect(JSON.stringify(capture)).not.toContain('synthetic-recipient');
  });

  it('consumes each configured failure once per port call', async () => {
    // Given
    e2eProgramAuthoringExternalPorts.failures.configure(
      E2E_EXTERNAL_FAILURE_OPERATIONS.STORAGE_PUT,
      2,
    );
    const input = {
      body: Buffer.from('deterministic-content'),
      contentType: 'text/plain',
      originalName: 'fixture.txt',
    };

    // When
    const first = e2eProgramAuthoringExternalPorts.storage.put(input);
    const second = e2eProgramAuthoringExternalPorts.storage.put(input);
    const third = e2eProgramAuthoringExternalPorts.storage.put(input);

    // Then
    await expect(first).rejects.toBeInstanceOf(SubmissionFileStorageError);
    await expect(second).rejects.toBeInstanceOf(SubmissionFileStorageError);
    await expect(third).resolves.toMatchObject({ contentLength: 21 });
    expect(
      e2eProgramAuthoringExternalPorts.failures.remaining(
        E2E_EXTERNAL_FAILURE_OPERATIONS.STORAGE_PUT,
      ),
    ).toBe(0);
  });

  it('limits failure configuration and routes smtp and GitHub failures through their ports', async () => {
    // Given
    e2eProgramAuthoringExternalPorts.failures.configure(
      E2E_EXTERNAL_FAILURE_OPERATIONS.SMTP_SEND,
      1,
    );
    e2eProgramAuthoringExternalPorts.failures.configure(
      E2E_EXTERNAL_FAILURE_OPERATIONS.GITHUB_CREATE,
      1,
    );

    // When
    const mail = e2eProgramAuthoringExternalPorts.mail.send({
      to: 'synthetic-recipient@example.test',
      subject: 'digest',
      body: 'deterministic-mail',
    });
    const github = e2eProgramAuthoringExternalPorts.github.createRepository(
      'new-repository',
      'description',
    );

    // Then
    await expect(mail).rejects.toBeInstanceOf(E2eExternalPortFailure);
    await expect(github).rejects.toBeInstanceOf(GithubOperationsError);
    expect(() =>
      e2eProgramAuthoringExternalPorts.failures.configure(
        E2E_EXTERNAL_FAILURE_OPERATIONS.STORAGE_GET,
        4,
      ),
    ).toThrow(RangeError);
  });

  it('consumes storage get and delete failures independently', async () => {
    // Given
    const stored = await e2eProgramAuthoringExternalPorts.storage.put({
      body: Buffer.from('deterministic-content'),
      contentType: 'text/plain',
      originalName: 'fixture.txt',
    });
    e2eProgramAuthoringExternalPorts.failures.configure(
      E2E_EXTERNAL_FAILURE_OPERATIONS.STORAGE_GET,
      1,
    );
    e2eProgramAuthoringExternalPorts.failures.configure(
      E2E_EXTERNAL_FAILURE_OPERATIONS.STORAGE_DELETE,
      1,
    );

    // When
    const failedGet = e2eProgramAuthoringExternalPorts.storage.get(
      stored.objectKey,
    );
    const successfulGet = e2eProgramAuthoringExternalPorts.storage.get(
      stored.objectKey,
    );
    const failedDelete = e2eProgramAuthoringExternalPorts.storage.delete(
      stored.objectKey,
    );
    const successfulDelete = e2eProgramAuthoringExternalPorts.storage.delete(
      stored.objectKey,
    );

    // Then
    await expect(failedGet).rejects.toBeInstanceOf(SubmissionFileStorageError);
    await expect(successfulGet).resolves.toBeInstanceOf(Readable);
    await expect(failedDelete).rejects.toBeInstanceOf(
      SubmissionFileStorageError,
    );
    await expect(successfulDelete).resolves.toBeUndefined();
  });

  it('clears configured failures without discarding cleanup evidence', async () => {
    // Given
    const stored = await e2eProgramAuthoringExternalPorts.storage.put({
      body: Buffer.from('deterministic-content'),
      contentType: 'text/plain',
      originalName: 'fixture.txt',
    });
    e2eProgramAuthoringExternalPorts.failures.configure(
      E2E_EXTERNAL_FAILURE_OPERATIONS.STORAGE_DELETE,
      1,
    );

    // When
    e2eProgramAuthoringExternalPorts.resetFailures();

    // Then
    await expect(
      e2eProgramAuthoringExternalPorts.storage.get(stored.objectKey),
    ).resolves.toBeInstanceOf(Readable);
    await expect(
      e2eProgramAuthoringExternalPorts.storage.delete(stored.objectKey),
    ).resolves.toBeUndefined();
  });
});
