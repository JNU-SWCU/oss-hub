import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROGRAM_PURGE_DELETION_ORDER } from './program-purge-deletion-matrix';

type RelationEdge = {
  readonly parent: string;
  readonly child: string;
};

function schemaProgramChildGraph(schema: string): readonly string[] {
  const edges = parseRequiredForeignKeyEdges(schema);
  const traversed = new Set<string>();
  const queue = ['Program'];

  while (queue.length > 0) {
    const parent = queue.shift();
    if (!parent) continue;
    for (const edge of edges.filter((candidate) => candidate.parent === parent)) {
      const relation = `${edge.parent}->${edge.child}`;
      if (traversed.has(relation)) continue;
      traversed.add(relation);
      const operation = PROGRAM_PURGE_DELETION_ORDER.find((step) =>
        (step.covers as readonly string[]).includes(relation),
      )?.operation;
      // 새 관계는 여기서 계속 탐색해 비교 대상에 넣는다. 그래야 matrix를 갱신하지
      // 않은 schema 확장이 조용히 지나가지 않는다.
      if (operation !== 'DETACH') queue.push(edge.child);
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
    const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    const actual = schemaProgramChildGraph(schema);
    const covered = [
      ...new Set(
        PROGRAM_PURGE_DELETION_ORDER.flatMap((step) => step.covers)
          .filter((relation) => !relation.startsWith('logical:')),
      ),
    ].sort();

    expect(actual).toEqual(covered);
    expect(PROGRAM_PURGE_DELETION_ORDER.flatMap((step) => step.covers)).toEqual(
      expect.arrayContaining([
        'logical:Program->OutboxEvent',
        'logical:Program->PublicShowcaseRepository',
      ]),
    );
  });

  it('자식이 부모보다 먼저 처리되는 bottom-up 순서를 고정한다', () => {
    const position = (id: string) =>
      PROGRAM_PURGE_DELETION_ORDER.findIndex((step) => step.id === id);

    expect(position('board-comments')).toBeLessThan(position('board-posts'));
    expect(position('submission-files')).toBeLessThan(
      position('submission-revisions'),
    );
    expect(position('submission-reviews')).toBeLessThan(
      position('submission-revisions'),
    );
    expect(position('submission-revisions')).toBeLessThan(
      position('submissions'),
    );
    expect(position('milestone-document-review-histories')).toBeLessThan(
      position('milestone-document-submissions'),
    );
    expect(position('milestone-document-submissions')).toBeLessThan(
      position('milestone-documents'),
    );
    expect(position('milestone-document-template-files')).toBeLessThan(
      position('milestone-documents'),
    );
    expect(position('applications')).toBeLessThan(position('teams'));
    expect(position('teams')).toBeLessThan(
      PROGRAM_PURGE_DELETION_ORDER.length,
    );
  });
});
