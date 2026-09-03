import {
  E2E_EXTERNAL_FAILURE_OPERATIONS,
  E2eExternalPortRegistry,
  type E2eExternalFailureOperation,
} from './e2e-external-port-registry';
import type { E2eFailureKind } from './e2e-program-authoring.types';
import { DeadlineDigestService } from '../notifications/deadline-digest.service';
import { ProgramAuthoringService } from '../programs/program-authoring.service';
import { ProgramAuthoringUploadMaintenanceService } from '../programs/program-authoring-upload-maintenance.service';
import { ProgramAuthoringUploadService } from '../programs/program-authoring-upload.service';
import type { ProgramAuthoringRequest } from '../programs/program-authoring.types';
import { E2eAdapterError } from './e2e-program-authoring.adapter-error';
import { E2eExternalPortFault } from './e2e-external-port-registry';
import {
  E2E_NOW,
  E2E_PROGRAM_ID,
  E2E_STAFF_GITHUB_ID,
  E2E_STAFF_ID,
} from './e2e-program-authoring-fixture';

export function failureOperation(
  kind: E2eFailureKind,
): E2eExternalFailureOperation {
  switch (kind) {
    case 'upload':
      return E2E_EXTERNAL_FAILURE_OPERATIONS.STORAGE_PUT;
    case 'prisma':
      return E2E_EXTERNAL_FAILURE_OPERATIONS.PRISMA_TRANSACTION;
    case 'smtp':
      return E2E_EXTERNAL_FAILURE_OPERATIONS.SMTP_SEND;
    case 'github':
      return E2E_EXTERNAL_FAILURE_OPERATIONS.GITHUB_CREATE;
    case 'cleanup':
      return E2E_EXTERNAL_FAILURE_OPERATIONS.STORAGE_DELETE;
  }
}

export function uploadFile(name: string) {
  const buffer = Buffer.from(`%PDF-1.4\n${name}\n`);
  return {
    buffer,
    originalname: name,
    mimetype: 'application/pdf',
    size: buffer.byteLength,
  };
}

export function configureFailure(
  registry: E2eExternalPortRegistry,
  kind: E2eFailureKind,
  attempts: number,
): void {
  registry.configure(failureOperation(kind), attempts);
}

export async function stalePreview(
  deadlines: DeadlineDigestService,
): Promise<void> {
  const preview = await deadlines.previewProgram(
    E2E_STAFF_GITHUB_ID,
    E2E_PROGRAM_ID,
    E2E_NOW,
  );
  await deadlines.sendProgramFromPreview(
    E2E_STAFF_GITHUB_ID,
    E2E_PROGRAM_ID,
    preview,
    // 프리뷰 발급 이후 시간이 흘렀다고 판정되도록 고정 앵커보다 살짝 뒤의 시각을 만든다.
    new Date(E2E_NOW.getTime() + 10 * 60 * 1000 + 1),
  );
}

export async function exercisePrismaFailure(
  authoring: ProgramAuthoringService,
  uploadId: string,
): Promise<void> {
  try {
    await authoring.create(
      E2E_STAFF_GITHUB_ID,
      'e2e-prisma-fault',
      prismaAggregateRequest(uploadId),
    );
  } catch (error) {
    if (error instanceof E2eExternalPortFault) throw new E2eAdapterError(409);
    throw error;
  }
}

function prismaAggregateRequest(uploadId: string): ProgramAuthoringRequest {
  return {
    name: `${E2E_PROGRAM_ID}:aggregate`,
    organizer: `${E2E_PROGRAM_ID}:organizer`,
    trackType: 'EXTRACURRICULAR',
    applicationStartAt: '2026-08-01T00:00:00.000Z',
    applicationEndAt: '2026-08-20T00:00:00.000Z',
    endAt: '2026-08-30T00:00:00.000Z',
    description: `${E2E_PROGRAM_ID}:aggregate`,
    milestones: [
      {
        name: `${E2E_PROGRAM_ID}:aggregate-milestone`,
        dueAt: '2026-08-20T09:00:00.000Z',
        documents: [
          {
            name: `${E2E_PROGRAM_ID}:aggregate-document`,
            required: true,
            templateUploadId: uploadId,
          },
        ],
      },
    ],
  };
}

export async function exerciseSmtpFailure(
  deadlines: DeadlineDigestService,
): Promise<void> {
  const preview = await deadlines.previewProgram(
    E2E_STAFF_GITHUB_ID,
    E2E_PROGRAM_ID,
    E2E_NOW,
  );
  const result = await deadlines.sendProgramFromPreview(
    E2E_STAFF_GITHUB_ID,
    E2E_PROGRAM_ID,
    preview,
    E2E_NOW,
  );
  if (result.failedCount > 0) throw new E2eAdapterError(409);
}

export async function exerciseCleanupFailure(
  uploads: ProgramAuthoringUploadService,
  maintenance: ProgramAuthoringUploadMaintenanceService,
): Promise<never> {
  const upload = await uploads.upload(E2E_STAFF_ID, uploadFile('cleanup.pdf'));
  await uploads.delete(E2E_STAFF_ID, upload.id);
  await maintenance.runDue();
  throw new E2eAdapterError(409);
}
