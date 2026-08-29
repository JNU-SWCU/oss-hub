import { Inject, Injectable } from '@nestjs/common';
import { ApplicationStatus, RepositoryConnectionMode } from '@prisma/client';
import { ApplicationsService } from '../applications/applications.service';
import { MilestoneDocumentCurrentFileService } from '../milestone-documents/milestone-document-current-file.service';
import { MilestoneDocumentFilesService } from '../milestone-documents/milestone-document-files.service';
import { MilestoneDocumentsService } from '../milestone-documents/milestone-documents.service';
import {
  DeadlineDigestService,
  type DeadlineDigestSendRequest,
} from '../notifications/deadline-digest.service';
import { ProgramAuthoringService } from '../programs/program-authoring.service';
import { ProgramAuthoringUploadMaintenanceService } from '../programs/program-authoring-upload-maintenance.service';
import { ProgramAuthoringUploadService } from '../programs/program-authoring-upload.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubmissionFileCleanupService } from '../submissions/submission-file-cleanup.service';
import {
  REPOSITORY_E2E_ORCHESTRATION_PORT,
  type RepositoryE2eOrchestrationPort,
} from './repository-e2e-orchestration.port';
import { e2eProgramAuthoringExternalPorts } from './e2e-external-ports';
import {
  configureFailure,
  exercisePrismaFailure,
  exerciseSmtpFailure,
  stalePreview,
  uploadFile,
} from './e2e-program-authoring-exercise-support';
import { E2eAdapterError } from './e2e-program-authoring.adapter-error';
import {
  E2E_FOREIGN_STUDENT_GITHUB_ID,
  E2E_FOREIGN_STUDENT_ID,
  E2E_NOW,
  E2E_STAFF_GITHUB_ID,
  E2E_STAFF_ID,
  E2E_STUDENT_GITHUB_ID,
  E2E_STUDENT_ID,
  E2eProgramAuthoringFixture,
} from './e2e-program-authoring-fixture';
import type {
  E2eFailureKind,
  E2eProgramAuthoringGraph,
  E2eProgramAuthoringPort,
  E2eProgramAuthoringState,
} from './e2e-program-authoring.types';
export {
  E2E_PROGRAM_AUTHORING_PORT,
  type E2eProgramAuthoringPort,
  type E2eProgramAuthoringState,
} from './e2e-program-authoring.types';

@Injectable()
export class E2eProgramAuthoringAdapter implements E2eProgramAuthoringPort {
  private readonly fixtures: E2eProgramAuthoringFixture;
  private uploadFailureTokenId: string | null = null;
  private cleanupTokenId: string | null = null;
  private prismaUploadTokenId: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly applications: ApplicationsService,
    @Inject(REPOSITORY_E2E_ORCHESTRATION_PORT)
    private readonly repositories: RepositoryE2eOrchestrationPort,
    private readonly deadlines: DeadlineDigestService,
    private readonly uploads: ProgramAuthoringUploadService,
    private readonly uploadMaintenance: ProgramAuthoringUploadMaintenanceService,
    private readonly authoring: ProgramAuthoringService,
    private readonly files: MilestoneDocumentFilesService,
    private readonly documents: MilestoneDocumentsService,
    private readonly currentFiles: MilestoneDocumentCurrentFileService,
    private readonly submissionFileCleanup: SubmissionFileCleanupService,
  ) {
    this.fixtures = new E2eProgramAuthoringFixture(prisma);
  }

  async reset(): Promise<void> {
    e2eProgramAuthoringExternalPorts.resetFailures();
    await this.uploadMaintenance.runDue();
    await this.removePrismaAggregate();
    await this.fixtures.reset();
    this.uploadFailureTokenId = null;
    this.cleanupTokenId = null;
    this.prismaUploadTokenId = null;
    e2eProgramAuthoringExternalPorts.reset();
  }

  async fixture(): Promise<E2eProgramAuthoringGraph> {
    await this.fixtures.ensure();
    return this.fixtures.graph();
  }

  adopt(
    programId: string,
    authorGithubId: bigint,
  ): Promise<E2eProgramAuthoringGraph> {
    return this.fixtures.adopt(programId, authorGithubId);
  }

  async stateFor(programId: string): Promise<E2eProgramAuthoringState> {
    if (programId !== this.fixtures.graph().programId)
      throw new E2eAdapterError(404);
    // 제출물 교체는 구버전 SubmissionFile을 같은 트랜잭션에서 DELETE_PENDING으로
    // 마킹만 해두고 실제 스토리지 삭제·DELETED 전환은 시간당 cron
    // (SubmissionFileCleanupScheduler)에 위임한다(운영 정상 설계). E2E는 그 cron을
    // 기다릴 수 없으므로, ProgramAuthoringUpload 쪽 uploadMaintenance.runDue()와
    // 같은 패턴으로 orphan 집계 직전에 여기서 직접 배출시킨다.
    await this.submissionFileCleanup.runDue();
    return this.fixtures.state(e2eProgramAuthoringExternalPorts.capture());
  }

  preview() {
    return this.deadlines.previewProgram(
      E2E_STAFF_GITHUB_ID,
      this.fixtures.graph().programId,
      E2E_NOW,
    );
  }

  async send(preview: DeadlineDigestSendRequest): Promise<void> {
    const result = await this.deadlines.sendProgramFromPreview(
      E2E_STAFF_GITHUB_ID,
      this.fixtures.graph().programId,
      preview,
      E2E_NOW,
    );
    if (result.failedCount > 0) throw new E2eAdapterError(409);
  }

  async createApplication(mode: 'NEW' | 'OWN'): Promise<void> {
    const graph = this.fixtures.graph();
    await this.applications.create(
      E2E_STUDENT_GITHUB_ID,
      graph.programId,
      {
        answers: { title: 'E2E title', summary: 'E2E summary' },
        teamName: null,
        applicationTemplateVersion: 1,
        isRepositoryPublicationPlanned: false,
        repositoryConnectionMode:
          mode === 'NEW'
            ? RepositoryConnectionMode.NEW
            : RepositoryConnectionMode.OWN,
        repositoryUrl:
          mode === 'OWN' ? 'https://github.com/e2e-org/owned-public' : null,
      },
      E2E_NOW,
    );
  }

  async approveAndRun(): Promise<void> {
    await this.approveAndProvision();
    await this.sendDeadlineDigest();
  }

  async approve(): Promise<void> {
    await this.approveAndProvision(E2E_FOREIGN_STUDENT_ID);
  }

  private async approveAndProvision(
    applicantId = E2E_STUDENT_ID,
  ): Promise<void> {
    const application = await this.fixtures.application(applicantId);
    if (
      application === null ||
      application.status !== ApplicationStatus.SUBMITTED
    ) {
      throw new E2eAdapterError(409);
    }
    await this.applications.decide(
      E2E_STAFF_ID,
      application.id,
      E2E_STAFF_GITHUB_ID,
      { action: 'APPROVE' as const },
    );
    await this.consumeProvisionEvent();
    await this.runProvisionWorker(E2E_NOW);
  }

  private async consumeProvisionEvent(): Promise<void> {
    const workerId = 'e2e-program-authoring-worker';
    const consumed = await this.repositories.consumeNext(workerId, E2E_NOW);
    if (consumed.kind !== 'CONSUMED') throw new E2eAdapterError(409);
  }

  private async runProvisionWorker(now: Date): Promise<void> {
    const provisioned = await this.repositories.runNext(
      'e2e-program-authoring-worker',
      now,
    );
    if (provisioned.kind !== 'SUCCEEDED') throw new E2eAdapterError(409);
  }

  private async sendDeadlineDigest(): Promise<void> {
    const preview = await this.deadlines.previewProgram(
      E2E_STAFF_GITHUB_ID,
      this.fixtures.graph().programId,
      E2E_NOW,
    );
    await this.deadlines.sendProgramFromPreview(
      E2E_STAFF_GITHUB_ID,
      this.fixtures.graph().programId,
      preview,
      E2E_NOW,
    );
  }

  configureFailure(kind: E2eFailureKind, attempts: number): void {
    configureFailure(e2eProgramAuthoringExternalPorts.failures, kind, attempts);
  }

  async exercise(kind: E2eFailureKind): Promise<void> {
    switch (kind) {
      case 'upload':
        await this.exerciseUploadFailure();
        return;
      case 'prisma':
        await this.exercisePrismaFailure();
        return;
      case 'smtp':
        await this.exerciseSmtpFailure();
        return;
      case 'github':
        await this.exerciseGithubFailure();
        return;
      case 'cleanup':
        await this.exerciseCleanupFailure();
        return;
    }
  }

  async stalePreview(): Promise<void> {
    await stalePreview(this.deadlines);
  }

  async crossTeamCurrentFile(): Promise<void> {
    await this.ensureCurrentFile();
    await this.currentFiles.download(
      E2E_FOREIGN_STUDENT_GITHUB_ID,
      this.fixtures.graph().milestoneId,
      this.fixtures.graph().documentId,
    );
  }

  private async ensureCurrentFile(): Promise<void> {
    const application = await this.fixtures.application();
    if (application === null) {
      await this.createApplication('NEW');
      await this.approveAndRun();
    } else if (application.status === ApplicationStatus.SUBMITTED) {
      await this.approveAndRun();
    } else if (application.status !== ApplicationStatus.APPROVED) {
      throw new E2eAdapterError(409);
    }
    await this.files.uploadTemplate(
      E2E_STAFF_ID,
      this.fixtures.graph().milestoneId,
      this.fixtures.graph().documentId,
      uploadFile('template.pdf'),
    );
    const pending = await this.files.upload(
      E2E_STUDENT_GITHUB_ID,
      this.fixtures.graph().milestoneId,
      this.fixtures.graph().documentId,
      uploadFile('current.pdf'),
    );
    await this.documents.submit(
      E2E_STUDENT_GITHUB_ID,
      this.fixtures.graph().milestoneId,
      this.fixtures.graph().documentId,
      { text: null, fileId: pending.fileId },
      E2E_NOW,
    );
  }

  private async exerciseSmtpFailure(): Promise<void> {
    const application = await this.fixtures.application();
    if (application === null) {
      await this.createApplication('NEW');
      await this.approveAndProvision();
    } else if (application.status === ApplicationStatus.SUBMITTED) {
      await this.approveAndProvision();
    } else if (application.status !== ApplicationStatus.APPROVED) {
      throw new E2eAdapterError(409);
    } else {
      const job = await this.prisma.repositoryProvisionJob.findFirst({
        where: { applicationId: application.id },
        select: { status: true },
      });
      if (job?.status !== 'SUCCEEDED') throw new E2eAdapterError(409);
    }
    await exerciseSmtpFailure(this.deadlines);
  }

  private async exerciseGithubFailure(): Promise<void> {
    let application = await this.fixtures.application();
    if (application === null) {
      await this.createApplication('NEW');
      application = await this.fixtures.application();
    }
    if (application === null) throw new E2eAdapterError(409);
    if (application.status === ApplicationStatus.SUBMITTED) {
      await this.applications.decide(
        E2E_STAFF_ID,
        application.id,
        E2E_STAFF_GITHUB_ID,
        { action: 'APPROVE' as const },
      );
      await this.consumeProvisionEvent();
    } else if (application.status !== ApplicationStatus.APPROVED) {
      throw new E2eAdapterError(409);
    }
    const job = await this.prisma.repositoryProvisionJob.findFirst({
      where: { applicationId: application.id },
      select: { nextAttemptAt: true, status: true },
    });
    if (job === null) throw new E2eAdapterError(409);
    if (job.status === 'SUCCEEDED') return;
    await this.runProvisionWorker(
      job.nextAttemptAt > E2E_NOW ? job.nextAttemptAt : E2E_NOW,
    );
  }

  private async exercisePrismaFailure(): Promise<void> {
    if (this.prismaUploadTokenId === null) {
      const upload = await this.uploads.upload(
        E2E_STAFF_ID,
        uploadFile('aggregate.pdf'),
      );
      this.prismaUploadTokenId = upload.id;
    }
    await exercisePrismaFailure(this.authoring, this.prismaUploadTokenId);
  }

  private async removePrismaAggregate(): Promise<void> {
    const request = await this.prisma.programCreateRequest.findFirst({
      where: {
        actorId: E2E_STAFF_ID,
        idempotencyKey: 'e2e-prisma-fault', // gitleaks:allow — 결정론적 테스트 상수
      },
      select: {
        actorId: true,
        id: true,
        programId: true,
        uploads: { select: { id: true, storageKey: true } },
      },
    });
    if (request === null) return;
    await this.prisma.$transaction(async (transaction) => {
      await transaction.milestoneDocumentTemplateFile.deleteMany({
        where: {
          milestoneDocument: { milestone: { programId: request.programId } },
        },
      });
      await transaction.programAuthoringUpload.deleteMany({
        where: { id: { in: request.uploads.map((upload) => upload.id) } },
      });
      await transaction.programCreateRequest.delete({
        where: { actorId_id: { actorId: request.actorId, id: request.id } },
      });
      await transaction.milestoneDocument.deleteMany({
        where: { milestone: { programId: request.programId } },
      });
      await transaction.milestone.deleteMany({
        where: { programId: request.programId },
      });
      await transaction.program.delete({ where: { id: request.programId } });
    });
    for (const upload of request.uploads) {
      await e2eProgramAuthoringExternalPorts.storage.delete(upload.storageKey);
    }
  }

  private async exerciseUploadFailure(): Promise<void> {
    try {
      const upload = await this.uploads.upload(
        E2E_STAFF_ID,
        uploadFile('upload.pdf'),
      );
      await this.uploads.delete(E2E_STAFF_ID, upload.id);
      await this.uploadMaintenance.runDue();
      this.uploadFailureTokenId = null;
    } catch {
      this.uploadFailureTokenId = await this.latestPendingUploadId();
      await this.uploads.delete(E2E_STAFF_ID, this.uploadFailureTokenId);
      await this.uploadMaintenance.runDue();
      throw new E2eAdapterError(409);
    }
  }

  private async exerciseCleanupFailure(): Promise<void> {
    if (this.cleanupTokenId === null) {
      const upload = await this.uploads.upload(
        E2E_STAFF_ID,
        uploadFile('cleanup.pdf'),
      );
      this.cleanupTokenId = upload.id;
      await this.uploads.delete(E2E_STAFF_ID, upload.id);
      await this.uploadMaintenance.runDue();
      throw new E2eAdapterError(409);
    }
    await this.prisma.programAuthoringUpload.updateMany({
      where: {
        id: this.cleanupTokenId,
        actorId: E2E_STAFF_ID,
        lifecycle: 'DELETE_PENDING',
        storageKey: { startsWith: 'program-authoring/' },
      },
      data: {
        deleteClaimedAt: null,
        deleteClaimExpiresAt: null,
        deleteClaimOwner: null,
        nextDeleteAttemptAt: new Date(),
      },
    });
    await this.uploadMaintenance.runDue();
    this.cleanupTokenId = null;
  }

  private async latestPendingUploadId(): Promise<string> {
    const upload = await this.prisma.programAuthoringUpload.findFirst({
      where: {
        actorId: E2E_STAFF_ID,
        lifecycle: 'PENDING',
        storageKey: { startsWith: 'program-authoring/' },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (upload === null) throw new E2eAdapterError(409);
    return upload.id;
  }
}
