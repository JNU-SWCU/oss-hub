import * as fs from 'node:fs';
import * as path from 'node:path';

import { Prisma } from '@prisma/client';

describe('수집 편입 큐 계약 (ADR-010 §6)', () => {
  const model = Prisma.dmmf.datamodel.models.find(
    (candidate) => candidate.name === 'GithubRepository',
  );

  function fieldOf(name: string) {
    return model?.fields.find((field) => field.name === name);
  }

  it('GithubRepository 모델이 존재한다', () => {
    expect(model).toBeDefined();
  });

  describe('nextRunAt — 편입 시점을 스키마가 정한다', () => {
    it('기본값이 now() 다 — 행이 생기면 즉시 due 상태가 된다', () => {
      const field = fieldOf('nextRunAt');

      expect(field).toBeDefined();
      expect(field?.type).toBe('DateTime');

      expect(field?.isRequired).toBe(true);

      expect(field?.hasDefaultValue).toBe(true);
      expect(field?.default).toMatchObject({ name: 'now' });
    });

    it('nextRunAt 인덱스가 있다 — 가장 오래 굶은 것부터 꺼낼 수 있어야 한다', () => {
      const schemaPath = path.join(
        __dirname,
        '..',
        '..',
        'prisma',
        'schema.prisma',
      );
      const schema = fs.readFileSync(schemaPath, 'utf8');
      const modelBlock = schema.slice(
        schema.indexOf('model GithubRepository {'),
      );
      const body = modelBlock.slice(0, modelBlock.indexOf('\n}'));

      expect(body).toContain('@@index([nextRunAt])');
    });
  });

  describe('건강 지표 축', () => {
    it('lastSuccessAt 은 nullable 이다 — 한 번도 성공한 적 없음을 표현해야 한다', () => {
      const field = fieldOf('lastSuccessAt');

      expect(field).toBeDefined();
      expect(field?.type).toBe('DateTime');
      expect(field?.isRequired).toBe(false);
    });

    it('failureCount 는 0 으로 시작한다', () => {
      const field = fieldOf('failureCount');

      expect(field).toBeDefined();
      expect(field?.type).toBe('Int');
      expect(field?.isRequired).toBe(true);
      expect(field?.hasDefaultValue).toBe(true);
      expect(field?.default).toBe(0);
    });
  });

  describe('편입은 코드가 아니라 기본값이 한다', () => {
    it('저장소 관측 upsert 가 nextRunAt 을 직접 지정하지 않는다', () => {
      const source = fs.readFileSync(
        path.join(
          __dirname,
          'repository',
          'collection-incremental.repository.ts',
        ),
        'utf8',
      );
      const start = source.indexOf('async recordRepositoryObservation');
      expect(start).toBeGreaterThan(-1);

      const body = source.slice(start, source.indexOf('\n  }', start));

      expect(body).toContain('githubRepository.upsert');
      expect(body).not.toContain('nextRunAt');
    });
  });
});

describe('Contribution 입자 계약 (ADR-010 §4)', () => {
  const model = Prisma.dmmf.datamodel.models.find(
    (candidate) => candidate.name === 'Contribution',
  );

  function fieldOf(name: string) {
    return model?.fields.find((field) => field.name === name);
  }

  it('grain 은 이름이 아니라 기본키가 정의한다', () => {
    expect(model).toBeDefined();

    expect(model?.name).toBe('Contribution');
    expect(model?.primaryKey?.fields).toEqual([
      'repositoryId',
      'githubId',
      'date',
    ]);
  });

  it('사람 식별자는 githubId 하나이며 NOT NULL 이다', () => {
    const field = fieldOf('githubId');

    expect(field).toBeDefined();
    expect(field?.type).toBe('BigInt');

    expect(field?.isRequired).toBe(true);
  });

  it('date 는 날짜 축이다 — 저장에 연도 개념이 없다', () => {
    const field = fieldOf('date');

    expect(field).toBeDefined();
    expect(field?.type).toBe('DateTime');
    expect(field?.isRequired).toBe(true);

    const fieldNames = model?.fields.map((candidate) => candidate.name) ?? [];
    expect(fieldNames).not.toContain('year');
  });

  it('집계 수치만 담는다 — 개별 식별자와 본문을 보존하지 않는다', () => {
    const fieldNames = model?.fields.map((candidate) => candidate.name) ?? [];

    for (const forbidden of [
      'sha',
      'commitSha',
      'githubPullRequestId',
      'githubReleaseId',
      'message',
      'title',
      'body',
      'githubLogin',
    ]) {
      expect(fieldNames).not.toContain(forbidden);
    }

    for (const required of [
      'commitCount',
      'pullRequestCount',
      'releaseCount',
    ]) {
      expect(fieldNames).toContain(required);
    }
  });

  it('두 축을 인덱스가 각각 받친다', () => {
    const schemaPath = path.join(
      __dirname,
      '..',
      '..',
      'prisma',
      'schema.prisma',
    );
    const schema = fs.readFileSync(schemaPath, 'utf8');
    const block = schema.slice(schema.indexOf('model Contribution {'));
    const body = block.slice(0, block.indexOf('\n}'));

    expect(body).toContain('@@id([repositoryId, githubId, date])');
    expect(body).toContain('@@index([githubId, date])');
  });

  it('저장소가 사라지면 기여도 함께 사라진다', () => {
    const relation = fieldOf('repository');

    expect(relation?.relationOnDelete).toBe('Cascade');
  });

  it('마이그레이션이 추가만 한다 — 옛 집계 테이블을 건드리지 않는다', () => {
    const migrationPath = path.join(
      __dirname,
      '..',
      '..',
      'prisma',
      'migrations',
      '20260809130000_add_contribution',
      'migration.sql',
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('CREATE TABLE "Contribution"');
    expect(sql).not.toMatch(/DROP\s+TABLE/iu);
    expect(sql).not.toMatch(/DROP\s+COLUMN/iu);
  });
});
