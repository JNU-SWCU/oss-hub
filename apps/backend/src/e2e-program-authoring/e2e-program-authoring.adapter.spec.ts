import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(__dirname, 'e2e-program-authoring.adapter.ts'),
  'utf8',
);

describe('E2eProgramAuthoringAdapter orchestration boundary', () => {
  it('uses application, outbox, worker, and deadline services for approval', () => {
    expect(source).toContain('this.applications.decide(');
    expect(source).toContain('this.repositories.consumeNext(');
    expect(source).toContain('this.repositories.runNext(');
    expect(source).toContain('this.deadlines.sendProgramFromPreview(');
  });

  it('does not fabricate repository, job, or notification success rows', () => {
    expect(source).not.toContain('repository.upsert(');
    expect(source).not.toContain('repositoryProvisionJob.upsert(');
    expect(source).not.toContain('notification.upsert(');
  });

  it('previews through production eligibility at the frozen fixture instant', () => {
    expect(source).toMatch(
      /this\.deadlines\.previewProgram\([\s\S]*?E2E_STAFF_GITHUB_ID,[\s\S]*?this\.fixtures\.graph\(\)\.programId,[\s\S]*?E2E_NOW,[\s\S]*?\);/u,
    );
  });
});
