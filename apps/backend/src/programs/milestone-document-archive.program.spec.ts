import { SubmissionStatus } from '@prisma/client';
import {
  archiveEntries,
  collectArchive,
} from './milestone-document-archive.fixture';
import {
  now,
  fileBody,
  program,
  teams,
  submission,
  fixture,
} from './milestone-document-archive.program-fixture';

describe('program, milestone and team current-submission ZIP scopes', () => {
  it('preserves document folders when staff select grouping by document across a program', async () => {
    const { service } = fixture();
    const archive = await service.archiveForProgramStaff(
      'program',
      { kind: 'PROGRAM', grouping: 'DOCUMENT' },
      now,
    );
    const entries = archiveEntries(await collectArchive(archive.body));
    expect(entries.map((entry) => entry.name)).toContain(
      '계획 - 보고서/가팀_계획 - 보고서.txt',
    );
    expect(entries.map((entry) => entry.name)).not.toContain(
      '가팀/가팀_계획 - 보고서.txt',
    );
  });

  it('PROGRAM includes text of every approved team and distinguishes same-name stage documents', async () => {
    const { service } = fixture();
    const archive = await service.archiveForProgramStaff(
      'program',
      { kind: 'PROGRAM' },
      now,
    );
    const bytes = await collectArchive(archive.body);
    const entries = archiveEntries(bytes);
    expect(entries.map((entry) => entry.name)).toEqual([
      '제출현황.csv',
      '가팀/가팀_계획 - 보고서.txt',
      '가팀/가팀_결과 - 보고서.txt',
      '나팀/나팀_결과 - 보고서.txt',
    ]);
    expect(bytes.length).toBe(archive.contentLength);
    expect(archive.fileName).toBe('예시 프로그램_전체_현재제출.zip');
    const manifest = entries[0]?.body.toString('utf8');
    expect(manifest).toContain('반려');
    expect(manifest).toContain('보완 요청');
    expect(manifest).toContain('미제출');
    expect(bytes.toString('utf8')).not.toContain('unapproved-application');
    expect(bytes.toString('utf8')).not.toContain('other-program-document');
  });

  it('TEAM includes that team across all stages in the program, never other teams', async () => {
    const { service, programs, repository } = fixture();
    programs.findApprovedTeams.mockResolvedValue([teams[0]]);
    const archive = await service.archiveForProgramStaff(
      'program',
      { kind: 'TEAM', teamId: 'team-0' },
      now,
    );
    const entries = archiveEntries(await collectArchive(archive.body));
    expect(programs.findApprovedTeams).toHaveBeenCalledWith(
      'program',
      'team-0',
    );
    expect(repository.findSubmissionsForArchive).toHaveBeenCalledWith(
      ['document-0', 'document-1'],
      now,
    );
    expect(entries.map((entry) => entry.name)).toEqual([
      '제출현황.csv',
      '가팀/가팀_계획 - 보고서.txt',
      '가팀/가팀_결과 - 보고서.txt',
    ]);
    expect(entries[0]?.body.toString('utf8')).not.toContain('나팀');
    expect(archive.fileName).toBe('예시 프로그램_가팀_현재제출.zip');
  });

  it('MILESTONE restricts both document query and manifest to one owned milestone', async () => {
    const { service, repository } = fixture();
    const archive = await service.archiveForProgramStaff(
      'program',
      { kind: 'MILESTONE', milestoneId: 'milestone-0' },
      now,
    );
    const entries = archiveEntries(await collectArchive(archive.body));
    expect(repository.findSubmissionsForArchive).toHaveBeenCalledWith(
      ['document-0'],
      now,
    );
    expect(entries.map((entry) => entry.name)).toEqual([
      '제출현황.csv',
      '가팀/가팀_보고서.txt',
    ]);
    expect(entries[0]?.body.toString('utf8')).not.toContain('결과');
    expect(archive.fileName).toBe('계획_2026-09-30.zip');
  });

  it.each(['absent', 'another-program-milestone'])(
    'rejects an out-of-program milestone: %s',
    async (milestoneId) => {
      const { service, repository } = fixture();
      await expect(
        service.archiveForProgramStaff(
          'program',
          { kind: 'MILESTONE', milestoneId },
          now,
        ),
      ).rejects.toMatchObject({ errorCode: { code: 'MSD_003' } });
      expect(repository.findSubmissionsForArchive).not.toHaveBeenCalled();
    },
  );

  it('does not present an unknown, unapproved or cross-program team as an empty ZIP', async () => {
    const { service, programs, repository } = fixture();
    programs.findApprovedTeams.mockResolvedValue([]);
    await expect(
      service.archiveForProgramStaff(
        'program',
        { kind: 'TEAM', teamId: 'unavailable' },
        now,
      ),
    ).rejects.toMatchObject({ errorCode: { status: 404 } });
    expect(repository.findSubmissionsForArchive).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing program', async () => {
    const { service, programs } = fixture();
    programs.findProgram.mockResolvedValue(null);
    await expect(
      service.archiveForProgramStaff('absent', { kind: 'PROGRAM' }, now),
    ).rejects.toMatchObject({ errorCode: { status: 404 } });
  });

  it('keeps current retained image bytes, text and unavailable-file evidence in the ZIP', async () => {
    const { service, repository, storage } = fixture();
    repository.findSubmissionsForArchive.mockResolvedValue([
      {
        ...submission('application-0', 'document-0', SubmissionStatus.APPROVED),
        hasCurrentFileEvidence: true,
        file: {
          storageKey: 'retained-image',
          originalFileName: 'old.png',
          sizeBytes: fileBody.length,
        },
      },
      {
        ...submission('application-0', 'document-1'),
        hasCurrentFileEvidence: true,
      },
    ]);
    const archive = await service.archiveForProgramStaff(
      'program',
      { kind: 'PROGRAM' },
      now,
    );
    const entries = archiveEntries(await collectArchive(archive.body));
    expect(entries.find((entry) => entry.name.endsWith('.png'))?.body).toEqual(
      fileBody,
    );
    expect(entries.filter((entry) => entry.name.endsWith('.txt'))).toHaveLength(
      2,
    );
    expect(entries[0]?.body.toString('utf8')).toContain(
      '첨부를 가져올 수 없음',
    );
    expect(storage.get).toHaveBeenCalledTimes(1);
    expect(storage.get).toHaveBeenCalledWith('retained-image');
  });

  it.each([true, false])(
    'creates a valid manifest-only ZIP when there are no teams/documents (%s)',
    async (noTeams) => {
      const { service, programs, storage } = fixture();
      if (noTeams) programs.findApprovedTeams.mockResolvedValue([]);
      else
        programs.findProgram.mockResolvedValue({
          name: program.name,
          milestones: [],
        });
      const archive = await service.archiveForProgramStaff(
        'program',
        { kind: 'PROGRAM' },
        now,
      );
      const bytes = await collectArchive(archive.body);
      expect(archiveEntries(bytes).map((entry) => entry.name)).toEqual([
        '제출현황.csv',
      ]);
      expect(bytes.length).toBe(archive.contentLength);
      expect(storage.get).not.toHaveBeenCalled();
    },
  );

  it('enforces the existing combined text/file size limit before opening storage', async () => {
    const { service, repository, storage } = fixture();
    repository.findSubmissionsForArchive.mockResolvedValue([
      {
        ...submission('application-0', 'document-0'),
        file: {
          storageKey: 'oversized',
          originalFileName: 'large.zip',
          sizeBytes: 2 * 1024 ** 3,
        },
      },
    ]);
    await expect(
      service.archiveForProgramStaff('program', { kind: 'PROGRAM' }, now),
    ).rejects.toMatchObject({ errorCode: { code: 'MSD_026' } });
    expect(storage.get).not.toHaveBeenCalled();
  });
});
