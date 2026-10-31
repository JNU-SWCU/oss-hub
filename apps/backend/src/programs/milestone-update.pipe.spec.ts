import { BadRequestException } from '@nestjs/common';
import { milestoneUpdatePipe } from './milestones.controller';

const pipe = milestoneUpdatePipe;
const legacy = { name: ' Legacy ', dueAt: '2026-11-01T00:00:00.000Z' };
const aggregate = {
  name: ' Aggregate ',
  startAt: '2026-10-21T00:00:00.000Z',
  dueAt: legacy.dueAt,
  instructions: null,
  documents: [{ id: null, name: ' Document ', required: true }],
  expectedFingerprint: 'a'.repeat(64),
};

it('preserves legacy omitted dates and whitespace until application validation', async () => {
  const command = await pipe.transform(legacy);
  expect(command).toEqual({ kind: 'legacy', input: legacy });
  expect(command.input).not.toHaveProperty('startAt');
});

it('preserves the legacy null date accepted by IsOptional', async () => {
  const input = { ...legacy, startAt: null, instructions: null };
  expect(await pipe.transform(input)).toEqual({ kind: 'legacy', input });
});

it('uses the aggregate DTO transforms before creating its command', async () => {
  expect(await pipe.transform(aggregate)).toEqual({
    kind: 'aggregate',
    input: {
      ...aggregate,
      name: 'Aggregate',
      documents: [{ id: null, name: 'Document', required: true }],
    },
  });
});

it.each([
  { documents: undefined },
  { documents: null },
  { documents: [] },
  { expectedFingerprint: undefined },
  { expectedFingerprint: null },
  { expectedFingerprint: '' },
])(
  'rejects incomplete aggregate input selected by property presence: %p',
  async (field) => {
    await expect(
      pipe.transform({ ...legacy, ...field }),
    ).rejects.toBeInstanceOf(BadRequestException);
  },
);

it.each([null, 'milestone', 42, []])(
  'rejects invalid body %p',
  async (body) => {
    await expect(pipe.transform(body)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  },
);

it.each([legacy, aggregate])(
  'keeps strict unknown-property rejection for %p',
  async (input) => {
    await expect(
      pipe.transform({ ...input, unrecognized: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
  },
);
