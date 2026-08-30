import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PROGRAM_PURGE_DELETION_ORDER } from './program-purge-deletion-matrix';

type RelationEdge = {
  readonly parent: string;
  readonly child: string;
};

/**
 * Program에서 실제 FK로는 닿지 않지만 purge가 논리적으로 자식 취급하는 모델.
 * 이 모델들의 FK 부모 관계도 계속 순회해야 그 아래 실제 FK 손자(예:
 * PublicShowcaseContributor)가 스키마 회귀 테스트에서 빠짐없이 드러난다.
 */
const LOGICAL_PROGRAM_CHILD_MODELS = ['PublicShowcaseRepository'] as const;

function schemaProgramChildGraph(schema: string): readonly string[] {
  const edges = parseRequiredForeignKeyEdges(schema);
  const traversed = new Set<string>();
  const queue = ['Program', ...LOGICAL_PROGRAM_CHILD_MODELS];

  while (queue.length > 0) {
    const parent = queue.shift();
    if (!parent) continue;
    for (const edge of edges.filter(
      (candidate) => candidate.parent === parent,
    )) {
      const relation = `${edge.parent}->${edge.child}`;
      if (traversed.has(relation)) continue;
      traversed.add(relation);
      // DETACH/PRESERVE 아래도 계속 순회한다 — 그래야 detach된 부모 밑에 조용히 새로
      // 붙는 손자 관계가 matrix 갱신 없이 지나가지 않는다. DELETE/TOMBSTONE으로 부모가
      // 사라지는 경우만 그 자식도 함께 사라지므로 계속 내려간다.
      queue.push(edge.child);
    }
  }

  return [...traversed].sort();
}

function parseRequiredForeignKeyEdges(schema: string): readonly RelationEdge[] {
  const models = schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm);
  const edges: RelationEdge[] = [];
  for (const match of models) {
    const [, child, body] = match;
    if (!child || !body) continue;
    for (const relation of body.matchAll(
      /^\s*\w+\s+(\w+)\??\s+@relation\([^\n]*fields:\s*\[/gm,
    )) {
      const parent = relation[1];
      if (parent) edges.push({ parent, child });
    }
  }
  return edges;
}

describe('PROGRAM_PURGE_DELETION_ORDER', () => {
  it('Program 전체 Prisma child graph를 빠짐없이 덮고, 새 관계가 생기면 명시적 분류를 요구한다', () => {
    const schema = readFileSync(
      join(process.cwd(), 'prisma/schema.prisma'),
      'utf8',
    );
    const actual = schemaProgramChildGraph(schema);
    const covered = [
      ...new Set(
        PROGRAM_PURGE_DELETION_ORDER.flatMap((step) => step.covers).filter(
          (relation) => !relation.startsWith('logical:'),
        ),
      ),
    ].sort();

    expect(actual).toEqual(covered);
    expect(PROGRAM_PURGE_DELETION_ORDER.flatMap((step) => step.covers)).toEqual(
      expect.arrayContaining([
        'logical:Program->OutboxEvent',
        'logical:Application->OutboxEvent',
        'logical:Program->PublicShowcaseRepository',
      ]),
    );
  });

  it('DETACH된 부모(GithubRepository) 아래의 손자는 조용히 순회가 멈추는 게 아니라 명시적으로 PRESERVE 처리된다', () => {
    const preserved = PROGRAM_PURGE_DELETION_ORDER.filter(
      (step) => step.operation === 'PRESERVE',
    ).flatMap((step) => step.covers);
    expect(preserved).toEqual(
      expect.arrayContaining([
        'GithubRepository->RepositoryInvitation',
        'GithubRepository->Contribution',
        'GithubRepository->CollectionRepositoryStream',
        'GithubRepository->CollectionCommitFact',
        'GithubRepository->CollectionPullRequestFact',
        'GithubRepository->CollectionReleaseFact',
      ]),
    );
    // 이 관계들은 다른 operation으로 이중 분류되지 않는다.
    const nonPreserveCovers = PROGRAM_PURGE_DELETION_ORDER.filter(
      (step) => step.operation !== 'PRESERVE',
    ).flatMap((step) => step.covers);
    for (const relation of preserved) {
      expect(nonPreserveCovers).not.toContain(relation);
    }
  });

  it('자식이 부모보다 먼저 처리되는 bottom-up 순서를 고정한다', () => {
    const position = (id: string) =>
      PROGRAM_PURGE_DELETION_ORDER.findIndex((step) => step.id === id);

    expect(position('board-comments')).toBeLessThan(position('board-posts'));
    expect(position('submission-files')).toBeLessThan(
      position('milestone-document-submission-histories'),
    );
    expect(position('milestone-document-review-histories')).toBeLessThan(
      position('milestone-document-submission-histories'),
    );
    expect(position('milestone-document-submission-histories')).toBeLessThan(
      position('milestone-document-submissions'),
    );
    expect(position('milestone-document-submissions')).toBeLessThan(
      position('milestone-documents'),
    );
    expect(position('milestone-document-template-files')).toBeLessThan(
      position('milestone-documents'),
    );
    expect(position('applications')).toBeLessThan(position('teams'));
    expect(position('teams')).toBeLessThan(PROGRAM_PURGE_DELETION_ORDER.length);
  });
});

/**
 * Notification/OutboxEvent는 Prisma FK가 아니라 payload JSON 필드나 idempotencyKey
 * 문자열에 programId(또는 applicationId 경유)를 박아 논리적으로 Program에 묶인다 — 스키마
 * 파싱만으로는 절대 드러나지 않는다. 이 섹션은 소스에서 실제 사용 중인 Notification
 * `type`/OutboxEvent `aggregateType` 리터럴을 전수 스캔해, 이미 알려진 값이 아니면
 * (=아직 purge가 분류하지 않은 새 논리적 program-linked 레코드가 생기면) 실패한다.
 */

const SRC_ROOT = join(process.cwd(), 'src');

function listSourceFiles(dir: string): readonly string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      files.push(...listSourceFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts')) {
      files.push(full);
    }
  }
  return files;
}

/** `receiver.method(` 호출부터 괄호 깊이가 0으로 돌아오는 지점까지 원문을 잘라낸다. */
function extractBalancedCallArguments(
  source: string,
  callStartIndex: number,
): string | null {
  const openParenIndex = source.indexOf('(', callStartIndex);
  if (openParenIndex === -1) return null;
  let depth = 0;
  for (let index = openParenIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(openParenIndex, index + 1);
    }
  }
  return null;
}

function findCallSites(source: string, pattern: RegExp): readonly string[] {
  const calls: string[] = [];
  for (const match of source.matchAll(pattern)) {
    const args = extractBalancedCallArguments(source, match.index ?? 0);
    if (args) calls.push(args);
  }
  return calls;
}

function scanLiterals(
  fieldName: string,
  callPattern: RegExp,
): ReadonlySet<string> {
  const literals = new Set<string>();
  for (const file of listSourceFiles(SRC_ROOT)) {
    const source = readFileSync(file, 'utf8');
    if (!callPattern.test(source)) continue;
    callPattern.lastIndex = 0;
    for (const callArgs of findCallSites(source, callPattern)) {
      const fieldPattern = new RegExp(`${fieldName}:\\s*'([^']+)'`, 'g');
      for (const fieldMatch of callArgs.matchAll(fieldPattern)) {
        const value = fieldMatch[1];
        if (value) literals.add(value);
      }
    }
  }
  return literals;
}

/**
 * Program-linked classification per Notification `type`. 값이 없는 새 type이 소스에서
 * 발견되면 아래 allowlist 완전성 테스트가 실패한다 — 즉 새 논리적 program-linked
 * 레코드는 이 표를 갱신하고 program-lifecycle.service.ts의 purge 로직도 함께 갱신하지
 * 않으면 테스트가 막는다.
 */
const NOTIFICATION_TYPE_CLASSIFICATION: Record<
  string,
  { readonly programLinked: boolean; readonly shape: string }
> = {
  APPLICATION_DECISION: {
    programLinked: true,
    shape: 'payload.programId',
  },
  APPLICATION_DECISION_ACKNOWLEDGED: {
    programLinked: true,
    shape:
      'idempotencyKey references a program-linked APPLICATION_DECISION notification id (`application-decision-acknowledged:${notificationId}`)',
  },
  DEADLINE_DIGEST: {
    programLinked: true,
    shape: 'idempotencyKey contains `:${programId}:`',
  },
  REPOSITORY_PROVISION_REQUESTED: {
    // OutboxEvent 타입이지 Notification type이 아니다 — 아래 outbox 스캔에서 다룬다.
    programLinked: false,
    shape: 'n/a (not a Notification type)',
  },
};

/** OutboxEvent aggregateType별 program-linkage. */
const OUTBOX_AGGREGATE_TYPE_CLASSIFICATION: Record<
  string,
  { readonly programLinked: boolean; readonly shape: string }
> = {
  PROGRAM: { programLinked: true, shape: 'aggregateId === programId' },
  Application: {
    programLinked: true,
    shape: 'aggregateId === applicationId; payload.programId',
  },
};

describe('program-linked logical record allowlist (Notification/OutboxEvent)', () => {
  it('소스의 모든 Notification type 리터럴이 분류표에 있고, program-linked면 purge 코드가 그 값을 실제로 참조한다', () => {
    const discoveredTypes = scanLiterals(
      'type',
      /\.notification\.(?:create|createMany)\(/g,
    );
    const purgeServiceSource = readFileSync(
      join(process.cwd(), 'src/programs/service/program-lifecycle.service.ts'),
      'utf8',
    );

    for (const type of discoveredTypes) {
      const classification = NOTIFICATION_TYPE_CLASSIFICATION[type];
      expect(classification).toBeDefined();
      if (classification?.programLinked) {
        expect(purgeServiceSource).toContain(`'${type}'`);
      }
    }
  });

  it('소스의 모든 OutboxEvent aggregateType 리터럴이 분류표에 있고, program-linked면 purge 코드가 그 값을 실제로 참조한다', () => {
    const discoveredAggregateTypes = scanLiterals(
      'aggregateType',
      /\.outboxEvent\.(?:create|createMany)\(/g,
    );
    const purgeServiceSource = readFileSync(
      join(process.cwd(), 'src/programs/service/program-lifecycle.service.ts'),
      'utf8',
    );

    for (const aggregateType of discoveredAggregateTypes) {
      const classification =
        OUTBOX_AGGREGATE_TYPE_CLASSIFICATION[aggregateType];
      expect(classification).toBeDefined();
      if (classification?.programLinked) {
        expect(purgeServiceSource).toContain(`'${aggregateType}'`);
      }
    }
  });
});
