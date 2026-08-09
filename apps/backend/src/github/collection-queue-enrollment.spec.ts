import * as fs from 'node:fs';
import * as path from 'node:path';

import { Prisma } from '@prisma/client';

/**
 * 수집 편입 큐의 계약 (ADR-010 §6).
 *
 * 핵심은 한 줄이다 — **행이 존재한다는 것이 곧 "이 저장소는 수집 대상"이다.**
 * 별도의 편입 단계도, "이 조건을 만족하면 수집한다"는 조건절도 두지 않는다.
 * 조건절로 멤버십을 표현하면 등록 경로가 늘 때마다 그 조건절을 찾아다녀야 하고,
 * 하나를 빠뜨리면 조용히 수집에서 빠진다.
 *
 * 그래서 이 계약은 스키마가 지킨다. `nextRunAt` 기본값이 `now()`이므로
 * 프로비저닝이 `NEW` 로 만들든 `OWN` 으로 연결하든, 인벤토리가 관측하든,
 * 행이 생기는 순간 큐에 들어간다. 코드가 아무것도 하지 않아도 된다.
 *
 * DB 없이 도는 계약 검사다 — Prisma DMMF와 소스를 읽어 판정한다.
 */
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
      // nullable 이면 "큐에 없음"을 표현할 수 있게 되어 조건절이 되살아난다.
      expect(field?.isRequired).toBe(true);

      // `now()` 는 DMMF에서 함수 형태로 온다.
      expect(field?.hasDefaultValue).toBe(true);
      expect(field?.default).toMatchObject({ name: 'now' });
    });

    it('nextRunAt 인덱스가 있다 — 가장 오래 굶은 것부터 꺼낼 수 있어야 한다', () => {
      // 인덱스가 없으면 큐 정렬이 전체 스캔이 되고, 저장소가 늘수록 스윕이 느려진다.
      const schemaPath = path.join(__dirname, '..', '..', 'prisma', 'schema.prisma');
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
      // 코드가 `nextRunAt` 을 써 넣기 시작하면 "언제 편입되는가"가 다시
      // 호출 지점마다 흩어진다. 기본값 하나로 고정돼 있어야 한다.
      const source = fs.readFileSync(
        path.join(__dirname, 'repository', 'collection-incremental.repository.ts'),
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

/**
 * `Contribution` 입자 계약 (ADR-010 §4).
 *
 * 이 테이블이 존재하는 이유는 두 화면이 같은 사실을 다르게 접기 때문이다 —
 * 연도로 접으면 랭킹, 저장소로 접으면 팀 기여도다. 입자가 이보다 굵으면
 * 둘 중 하나가 구조적으로 불가능해진다. 앞선 `*YearAggregate` 가 정확히 그랬다.
 */
describe('Contribution 입자 계약 (ADR-010 §4)', () => {
  const model = Prisma.dmmf.datamodel.models.find(
    (candidate) => candidate.name === 'Contribution',
  );

  function fieldOf(name: string) {
    return model?.fields.find((field) => field.name === name);
  }

  it('grain 은 이름이 아니라 기본키가 정의한다', () => {
    expect(model).toBeDefined();
    // 이름에 grain 을 박으면 grain 이 바뀔 때 이름이 거짓말이 된다.
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
    // nullable 이면 "귀속을 모르는 기여"가 적재될 수 있고, 그 순간
    // 합계가 누구의 것도 아닌 값을 포함하게 된다.
    expect(field?.isRequired).toBe(true);
  });

  it('date 는 날짜 축이다 — 저장에 연도 개념이 없다', () => {
    const field = fieldOf('date');

    expect(field).toBeDefined();
    expect(field?.type).toBe('DateTime');
    expect(field?.isRequired).toBe(true);

    // `year Int` 같은 칸이 생기면 새해 롤오버 특수 처리가 되살아나고
    // 프로그램 기간(달력 연도가 아닌 축)으로 자를 수 없게 된다.
    const fieldNames = model?.fields.map((candidate) => candidate.name) ?? [];
    expect(fieldNames).not.toContain('year');
  });

  it('집계 수치만 담는다 — 개별 식별자와 본문을 보존하지 않는다', () => {
    const fieldNames = model?.fields.map((candidate) => candidate.name) ?? [];

    // "무엇을 했는지"가 아니라 "얼마나 했는지"만 남긴다(ADR-006 저장 field inventory).
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
    // 저장소 축은 PK 선두, 사람 축은 복합 인덱스. 한쪽이 없으면 그 화면이 전체 스캔이 된다.
    const schemaPath = path.join(__dirname, '..', '..', 'prisma', 'schema.prisma');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    const block = schema.slice(schema.indexOf('model Contribution {'));
    const body = block.slice(0, block.indexOf('\n}'));

    expect(body).toContain('@@id([repositoryId, githubId, date])');
    expect(body).toContain('@@index([githubId, date])');
  });

  it('저장소가 사라지면 기여도 함께 사라진다', () => {
    // Contribution 은 GithubRepository aggregate 내부 entity 이지
    // 독립 aggregate 가 아니다. cascade 가 그 관계를 표현한다.
    const relation = fieldOf('repository');

    expect(relation?.relationOnDelete).toBe('Cascade');
  });

  it('마이그레이션이 추가만 한다 — 옛 집계 테이블을 건드리지 않는다', () => {
    // 확장 → 재수집 → 읽기 전환 → 드롭 순서에서 이 PR 은 첫 단계다.
    // 여기서 드롭이 섞이면 읽기 전환 전에 화면이 죽는다.
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
