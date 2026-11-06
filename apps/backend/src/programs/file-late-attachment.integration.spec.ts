import {
  ProgramAuthoringUploadTransactionRepository,
  FileCleanupRepository,
} from './files.repository';
import { FileCleanupService } from './file-cleanup.service';
import {
  ACTOR,
  COVER_ACTOR,
  authoring,
  prisma,
  publicCovers,
  request,
  seedUpload,
} from './program-cover.integration-fixtures';

it('deletes a cover attached after the program purge snapshot', async () => {
  const program = await authoring().create(
    COVER_ACTOR,
    'late-cover',
    request(),
  );
  const upload = await seedUpload();
  await prisma.program.update({
    where: { id: program.id },
    data: { lifecycle: 'DELETED' },
  });
  await prisma.$transaction((transaction) =>
    publicCovers.createProgramCover(transaction, {
      programId: program.id,
      actorId: ACTOR,
      upload: { ...upload, unexpired: true },
    }),
  );
  const objects = new Set([upload.storageKey]);
  const worker = new FileCleanupService(new FileCleanupRepository(prisma), {
    delete: (key: string) => {
      objects.delete(key);
      return Promise.resolve();
    },
  });

  await worker.runDue();

  expect(objects.has(upload.storageKey)).toBe(false);
  expect(
    await prisma.file.findUnique({
      where: { storageKey: upload.storageKey },
      select: { lifecycle: true },
    }),
  ).toEqual({ lifecycle: 'DELETED' });
});

it('deletes a template attached after the program purge snapshot', async () => {
  const program = await authoring().create(
    COVER_ACTOR,
    'late-template',
    request(),
  );
  const milestone = await prisma.milestone.findFirstOrThrow({
    where: { programId: program.id },
  });
  const requirement = await prisma.requirement.create({
    data: {
      milestoneId: milestone.id,
      name: 'Template',
      required: true,
      sortOrder: 1,
    },
  });
  const upload = await seedUpload('program-authoring/');
  await prisma.program.update({
    where: { id: program.id },
    data: { lifecycle: 'DELETED' },
  });
  await prisma.$transaction((transaction) =>
    new ProgramAuthoringUploadTransactionRepository().consumePendingProgramAuthoringUploads(
      transaction,
      ACTOR,
      [
        {
          requirementId: requirement.id,
          upload: { ...upload, unexpired: true },
        },
      ],
    ),
  );
  const objects = new Set([upload.storageKey]);
  const worker = new FileCleanupService(new FileCleanupRepository(prisma), {
    delete: (key) => {
      objects.delete(key);
      return Promise.resolve();
    },
  });

  await worker.runDue();

  expect(objects.has(upload.storageKey)).toBe(false);
  expect(
    await prisma.file.findUnique({
      where: { id: upload.id },
      select: { lifecycle: true },
    }),
  ).toEqual({ lifecycle: 'DELETED' });
});

it('deletes a submission file uploaded after the program purge snapshot', async () => {
  const program = await authoring().create(
    COVER_ACTOR,
    'late-submission',
    request(),
  );
  const milestone = await prisma.milestone.findFirstOrThrow({
    where: { programId: program.id },
  });
  const requirement = await prisma.requirement.create({
    data: {
      milestoneId: milestone.id,
      name: 'Submission',
      required: true,
      sortOrder: 1,
    },
  });
  const team = await prisma.team.create({
    data: {
      programId: program.id,
      name: 'Late team',
      leaderId: ACTOR,
      applicantId: ACTOR,
      answers: {},
      applicationTemplateVersion: 1,
    },
  });
  await prisma.program.update({
    where: { id: program.id },
    data: { lifecycle: 'DELETED' },
  });
  const upload = await seedUpload('submission-files/');
  const farFuture = new Date('2099-01-01');
  await prisma.file.update({
    where: { id: upload.id },
    data: {
      kind: 'SUBMISSION',
      teamId: team.id,
      requirementId: requirement.id,
      expiresAt: farFuture,
    },
  });
  const objects = new Set([upload.storageKey]);
  const worker = new FileCleanupService(new FileCleanupRepository(prisma), {
    delete: (key) => {
      objects.delete(key);
      return Promise.resolve();
    },
  });

  await worker.runDue();

  expect(objects.has(upload.storageKey)).toBe(false);
  expect(
    await prisma.file.findUnique({
      where: { id: upload.id },
      select: { lifecycle: true },
    }),
  ).toEqual({ lifecycle: 'DELETED' });
});
