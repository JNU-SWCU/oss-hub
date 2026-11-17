import { BoundedReadRepository } from './bounded-read.repository';
import { ReadCapExceededError } from './read-cap.error';

describe('BoundedReadRepository', () => {
  const reads = new BoundedReadRepository();

  describe('readCapped', () => {
    it('reads one row past the cap and returns rows within it', async () => {
      const read = jest.fn((take: number) =>
        Promise.resolve(Array.from({ length: Math.min(take, 3) }, (_, i) => i)),
      );

      await expect(reads.readCapped(3, 'Team', read)).resolves.toEqual([
        0, 1, 2,
      ]);
      expect(read).toHaveBeenCalledWith(4);
    });

    it('throws when the extra row comes back', async () => {
      await expect(
        reads.readCapped(3, 'Team', (take) =>
          Promise.resolve(Array.from({ length: take }, (_, i) => i)),
        ),
      ).rejects.toThrow(ReadCapExceededError);
    });

    it('checks nested relations of every row', async () => {
      await expect(
        reads.readCapped(
          5,
          'Team',
          () => Promise.resolve([{ members: [1, 2] }, { members: [1, 2, 3] }]),
          { members: 2 },
        ),
      ).rejects.toMatchObject({ scope: 'Team.members', cap: 2 });
    });
  });

  describe('assertNestedWithin', () => {
    it('passes rows whose nested lists stay within their caps', () => {
      const rows = [{ milestones: [{ requirements: [1, 2] }] }];

      expect(
        reads.assertNestedWithin(
          rows,
          { milestones: { cap: 1, nested: { requirements: 2 } } },
          'Program',
        ),
      ).toBe(rows);
    });

    it('throws on a nested list longer than its cap instead of truncating', () => {
      expect(() =>
        reads.assertNestedWithin(
          { milestones: [{ requirements: [1, 2, 3] }] },
          { milestones: { cap: 1, nested: { requirements: 2 } } },
          'Program',
        ),
      ).toThrow(ReadCapExceededError);
    });

    it('descends through single relations and ignores null results', () => {
      expect(() =>
        reads.assertNestedWithin(
          { team: { members: [1, 2, 3] } },
          { team: { nested: { members: 2 } } },
          'TeamMember',
        ),
      ).toThrow('TeamMember.team.members');
      expect(reads.assertNestedWithin(null, { members: 2 }, 'Team')).toBeNull();
    });
  });

  describe('readAllInBatches', () => {
    it('follows the cursor until a short batch and keeps every row', async () => {
      const all = Array.from({ length: 1201 }, (_, i) => i);
      const read = jest.fn((after: number | undefined, take: number) => {
        const start = after === undefined ? 0 : after + 1;
        return Promise.resolve(all.slice(start, start + take));
      });

      await expect(reads.readAllInBatches(read, (row) => row)).resolves.toEqual(
        all,
      );
      expect(read.mock.calls.map(([after]) => after)).toEqual([
        undefined,
        499,
        999,
      ]);
    });
  });
});
