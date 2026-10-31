import { ProgramListStatusFilterRepository } from './program-list-status-filter.repository';

function normalize(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

describe('programListStatusSortRank', () => {
  it('orders 모집중 → 진행중 → 예정 → 종료 (?sort=status 전용 순서)', () => {
    expect(
      new ProgramListStatusFilterRepository().programListStatusSortRank(
        'recruiting',
      ),
    ).toBe(0);
    expect(
      new ProgramListStatusFilterRepository().programListStatusSortRank(
        'in_progress',
      ),
    ).toBe(1);
    expect(
      new ProgramListStatusFilterRepository().programListStatusSortRank(
        'upcoming',
      ),
    ).toBe(2);
    expect(
      new ProgramListStatusFilterRepository().programListStatusSortRank(
        'ended',
      ),
    ).toBe(3);
  });
});

describe('programListOrderBySql', () => {
  const now = new Date('2026-07-21T00:00:00.000Z');

  it('sort가 없으면 레거시 기본 정렬(모집중 → 예정 → 진행중 → 종료)을 그대로 낸다', () => {
    const orderBy =
      new ProgramListStatusFilterRepository().programListOrderBySql(
        undefined,
        undefined,
        now,
      );
    const legacy =
      new ProgramListStatusFilterRepository().programListSortRankSql(now);
    expect(normalize(orderBy.sql)).toBe(
      normalize(
        `${legacy.sql} ASC, p."applicationEndAt" ASC, p."name" ASC, p."id" ASC`,
      ),
    );
  });

  it('sort=name — id를 tiebreak로 붙인 이름 정렬', () => {
    expect(
      normalize(
        new ProgramListStatusFilterRepository().programListOrderBySql(
          'name',
          'asc',
          now,
        ).sql,
      ),
    ).toBe(normalize('p."name" ASC, p."id" ASC'));
    expect(
      normalize(
        new ProgramListStatusFilterRepository().programListOrderBySql(
          'name',
          'desc',
          now,
        ).sql,
      ),
    ).toBe(normalize('p."name" DESC, p."id" ASC'));
  });

  it('direction 생략 시 asc로 간주한다', () => {
    expect(
      normalize(
        new ProgramListStatusFilterRepository().programListOrderBySql(
          'name',
          undefined,
          now,
        ).sql,
      ),
    ).toBe(normalize('p."name" ASC, p."id" ASC'));
  });

  it('sort=applicationPeriod — applicationStartAt 기준, id tiebreak', () => {
    expect(
      normalize(
        new ProgramListStatusFilterRepository().programListOrderBySql(
          'applicationPeriod',
          'asc',
          now,
        ).sql,
      ),
    ).toBe(normalize('p."applicationStartAt" ASC, p."id" ASC'));
    expect(
      normalize(
        new ProgramListStatusFilterRepository().programListOrderBySql(
          'applicationPeriod',
          'desc',
          now,
        ).sql,
      ),
    ).toBe(normalize('p."applicationStartAt" DESC, p."id" ASC'));
  });

  it('sort=status — 파생 상태를 CASE로 모집중(0)→진행중(1)→예정(2)→종료(3) 랭크로 매기고, applicationEndAt·name·id를 tiebreak로 둔다', () => {
    const sql = normalize(
      new ProgramListStatusFilterRepository().programListOrderBySql(
        'status',
        'asc',
        now,
      ).sql,
    );
    expect(sql).toContain(
      normalize(`CASE (
      CASE
        WHEN p."lifecycle" = 'ARCHIVED' THEN 'ended'
        WHEN p."endAt" < ? THEN 'ended'
        WHEN p."applicationStartAt" > ? THEN 'upcoming'
        WHEN p."applicationEndAt" >= ? THEN 'recruiting'
        ELSE 'in_progress'
      END
    )
      WHEN 'recruiting' THEN 0
      WHEN 'in_progress' THEN 1
      WHEN 'upcoming' THEN 2
      WHEN 'ended' THEN 3
    END`),
    );
    expect(
      sql.endsWith('ASC, p."applicationEndAt" ASC, p."name" ASC, p."id" ASC'),
    ).toBe(true);
  });

  it('sort=status desc는 상태 랭크에만 DESC를 붙이고 tiebreak는 그대로 둔다', () => {
    const sql = normalize(
      new ProgramListStatusFilterRepository().programListOrderBySql(
        'status',
        'desc',
        now,
      ).sql,
    );
    expect(
      sql.endsWith('DESC, p."applicationEndAt" ASC, p."name" ASC, p."id" ASC'),
    ).toBe(true);
  });

  it('모든 분기가 마지막에 결정적 tiebreak p."id" ASC를 둔다 — 페이지네이션 중복·누락 방지', () => {
    const branches = [
      new ProgramListStatusFilterRepository().programListOrderBySql(
        undefined,
        undefined,
        now,
      ),
      new ProgramListStatusFilterRepository().programListOrderBySql(
        'name',
        'asc',
        now,
      ),
      new ProgramListStatusFilterRepository().programListOrderBySql(
        'name',
        'desc',
        now,
      ),
      new ProgramListStatusFilterRepository().programListOrderBySql(
        'applicationPeriod',
        'asc',
        now,
      ),
      new ProgramListStatusFilterRepository().programListOrderBySql(
        'applicationPeriod',
        'desc',
        now,
      ),
      new ProgramListStatusFilterRepository().programListOrderBySql(
        'status',
        'asc',
        now,
      ),
      new ProgramListStatusFilterRepository().programListOrderBySql(
        'status',
        'desc',
        now,
      ),
    ];
    for (const branch of branches) {
      expect(normalize(branch.sql).endsWith('p."id" ASC')).toBe(true);
    }
  });
});
