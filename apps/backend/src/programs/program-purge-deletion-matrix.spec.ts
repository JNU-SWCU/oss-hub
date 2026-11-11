import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  PROGRAM_PURGE_DELETION_ORDER,
  TEAM_PURGE_DELETION_ORDER,
} from './program-lifecycle.config';

type RelationEdge = {
  readonly parent: string;
  readonly child: string;
};

function schemaProgramChildGraph(schema: string): readonly string[] {
  return schemaChildGraph(schema, ['Program']);
}

function schemaChildGraph(
  schema: string,
  roots: readonly string[],
): readonly string[] {
  const edges = parseRequiredForeignKeyEdges(schema);
  const traversed = new Set<string>();
  const queue = [...roots];

  while (queue.length > 0) {
    const parent = queue.shift();
    if (!parent) continue;
    for (const edge of edges.filter(
      (candidate) => candidate.parent === parent,
    )) {
      const relation = `${edge.parent}->${edge.child}`;
      if (traversed.has(relation)) continue;
      traversed.add(relation);

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
      if (parent === 'File' && child === 'Program') continue;
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
    const modelNames = new Set(
      [...schema.matchAll(/^model (\w+) \{/gm)].map((match) => match[1]),
    );
    const actual = schemaProgramChildGraph(schema);
    const covered = [
      ...new Set(
        PROGRAM_PURGE_DELETION_ORDER.flatMap((step) => step.covers).filter(
          (relation) =>
            !relation.startsWith('logical:') &&
            relation.split('->').every((model) => modelNames.has(model)),
        ),
      ),
    ].sort();

    expect(actual).toEqual(covered);
    expect(PROGRAM_PURGE_DELETION_ORDER.flatMap((step) => step.covers)).toEqual(
      expect.arrayContaining(['logical:Team->OutboxEvent']),
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
    expect(position('files')).toBeLessThan(
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
    expect(position('milestone-document-submissions')).toBeLessThan(
      position('teams'),
    );
    expect(position('team-members')).toBeLessThan(position('teams'));
    expect(position('teams')).toBeLessThan(PROGRAM_PURGE_DELETION_ORDER.length);
  });
});

describe('TEAM_PURGE_DELETION_ORDER', () => {
  const teamCovers = TEAM_PURGE_DELETION_ORDER.flatMap((step) => step.covers);

  it('팀의 물리 삭제 순서와 프로그램의 상태 삭제를 구분한다', () => {
    const programIds = PROGRAM_PURGE_DELETION_ORDER.map((step) => step.id);
    const teamIds = TEAM_PURGE_DELETION_ORDER.map((step) => step.id);

    expect(new Set(teamIds).size).toBe(teamIds.length);
    expect(teamIds).toEqual(programIds.filter((id) => teamIds.includes(id)));

    for (const step of TEAM_PURGE_DELETION_ORDER) {
      const origin = PROGRAM_PURGE_DELETION_ORDER.find(
        (candidate) => candidate.id === step.id,
      );
      expect(['PRESERVE', 'TOMBSTONE']).toContain(origin?.operation);
      for (const relation of step.covers) {
        if (!relation.startsWith('logical:')) {
          expect(origin?.covers).toContain(relation);
        }
      }
    }
  });

  it('Team 전체 Prisma child graph를 빠짐없이 덮고, 프로그램에만 매달린 관계는 끌어오지 않는다', () => {
    const schema = readFileSync(
      join(process.cwd(), 'prisma/schema.prisma'),
      'utf8',
    );
    const modelNames = new Set(
      [...schema.matchAll(/^model (\w+) \{/gm)].map((match) => match[1]),
    );
    const actual = schemaChildGraph(schema, ['Team']);
    const covered = [
      ...new Set(
        teamCovers.filter(
          (relation) =>
            !relation.startsWith('logical:') &&
            relation !== 'Program->Team' &&
            relation.split('->').every((model) => modelNames.has(model)),
        ),
      ),
    ].sort();

    expect(covered).toEqual(actual);

    expect(teamCovers).toContain('Program->Team');

    for (const programOnly of [
      'Program->BoardPost',
      'BoardPost->BoardComment',
      'Program->Milestone',
      'Milestone->Requirement',
      'Requirement->Submission',
      'Requirement->File',
      'Program->File',
      'Program->GithubRepository',
      'Program->Application',
      'logical:Program->Notification[DEADLINE_DIGEST,idempotencyKey]',
    ]) {
      expect(teamCovers).not.toContain(programOnly);
    }
  });

  it('팀 삭제는 GithubRepository와 그 아래 수집 이력을 DELETE로 분류한다', () => {
    const repository = TEAM_PURGE_DELETION_ORDER.find(
      (step) => step.id === 'github-repositories',
    );
    expect(repository?.operation).toBe('DELETE');
    expect(repository?.covers).toEqual(['Team->GithubRepository']);

    const deleted = TEAM_PURGE_DELETION_ORDER.filter(
      (step) => step.operation === 'DELETE',
    ).flatMap((step) => step.covers);
    expect(deleted).toEqual(
      expect.arrayContaining([
        'GithubRepository->Contribution',
        'GithubRepository->CollectionCommitFact',
        'GithubRepository->CollectionPullRequestFact',
        'GithubRepository->CollectionReleaseFact',
        'GithubRepository->CollectionRepositoryStream',
        'GithubRepository->RepositoryInvitation',
      ]),
    );
    expect(
      TEAM_PURGE_DELETION_ORDER.filter((step) => step.operation === 'PRESERVE'),
    ).toEqual([
      {
        id: 'team-repos',
        operation: 'PRESERVE',
        covers: ['Team->TeamRepo'],
      },
    ]);
  });

  it('submission → teamInvitation → teamMember → team 순서를 고정한다', () => {
    const position = (id: string) =>
      TEAM_PURGE_DELETION_ORDER.findIndex((step) => step.id === id);

    expect(position('milestone-document-submissions')).toBeLessThan(
      position('team-invitations'),
    );
    expect(position('team-invitations')).toBeLessThan(position('team-members'));
    expect(position('team-members')).toBeLessThan(position('teams'));
    expect(position('teams')).toBe(TEAM_PURGE_DELETION_ORDER.length - 1);

    expect(position('files')).toBeLessThan(
      position('milestone-document-submission-histories'),
    );
    expect(position('milestone-document-submission-histories')).toBeLessThan(
      position('milestone-document-submissions'),
    );
    expect(position('milestone-document-submissions')).toBeLessThan(
      position('team-invitations'),
    );

    expect(position('github-repositories')).toBeLessThan(
      position('team-invitations'),
    );
  });
});

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
  TEAM_DELETED: {
    programLinked: true,
    shape: 'payload.programId',
  },
  REPOSITORY_PROVISION_REQUESTED: {
    programLinked: false,
    shape: 'n/a (not a Notification type)',
  },
};

const OUTBOX_AGGREGATE_TYPE_CLASSIFICATION: Record<
  string,
  { readonly programLinked: boolean; readonly shape: string }
> = {
  Team: {
    programLinked: true,
    shape: 'aggregateId === teamId; payload.programId',
  },
};

describe('program-linked logical record allowlist (Notification/OutboxEvent)', () => {
  it('프로그램 알림을 빠짐없이 분류하고 상태 삭제에서 보존한다', () => {
    const discoveredTypes = scanLiterals(
      'type',
      /\.notification\.(?:create|createMany)\(/g,
    );
    const preservedRelations = PROGRAM_PURGE_DELETION_ORDER.filter(
      (step) => step.operation === 'PRESERVE',
    ).flatMap((step) => step.covers);

    for (const type of discoveredTypes) {
      const classification = NOTIFICATION_TYPE_CLASSIFICATION[type];
      expect(classification).toBeDefined();
      if (classification?.programLinked) {
        expect(
          preservedRelations.some((relation) =>
            relation.includes(`Notification[${type},`),
          ),
        ).toBe(true);
      }
    }
  });

  it('프로그램 Outbox aggregate를 빠짐없이 분류하고 상태 삭제에서 보존한다', () => {
    const discoveredAggregateTypes = scanLiterals(
      'aggregateType',
      /\.outboxEvent\.(?:create|createMany)\(/g,
    );
    const preservedRelations = PROGRAM_PURGE_DELETION_ORDER.filter(
      (step) => step.operation === 'PRESERVE',
    ).flatMap((step) => step.covers);

    for (const aggregateType of discoveredAggregateTypes) {
      const classification =
        OUTBOX_AGGREGATE_TYPE_CLASSIFICATION[aggregateType];
      expect(classification).toBeDefined();
      if (classification?.programLinked) {
        expect(preservedRelations).toContain(
          `logical:${aggregateType}->OutboxEvent`,
        );
      }
    }
  });
});
