import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { AuditLogPageResponseDto } from '../../src/admin/dto/audit-log-page-response.dto';
import { auditRow } from '../../src/platform/audit-log-mapping.fixture';
import { SubmissionAuditSourceService } from '../../src/platform/submission-audit-source.service';

const validator = `
const { createRequire } = require('node:module');
const Ajv = createRequire(require.resolve('eslint'))('ajv');
const document = require('../../verify/openapi.baseline.json');
const validate = new Ajv({ nullable: true, allErrors: true })
  .compile(document.components.schemas.AuditChangeResponseDto);
const valid = validate(JSON.parse(process.argv[1]));
process.stdout.write(JSON.stringify({ valid, errors: validate.errors }));
`;

function validate(value: unknown): unknown {
  return JSON.parse(
    execFileSync(process.execPath, ['-e', validator, JSON.stringify(value)], {
      cwd: resolve(__dirname, '../..'),
      encoding: 'utf8',
    }),
  );
}

it('validates the serialized submission revision change against the generated contract', () => {
  const entry = new SubmissionAuditSourceService().toAuditEntry(
    auditRow({
      source: 'SUBMISSION',
      action: 'SUBMISSION_SUBMITTED',
      targetType: 'SUBMISSION',
      category: 'SUBMISSION',
      metadata: {
        schemaVersion: 1,
        revision: 1,
        requirementName: 'Synthetic report',
      },
    }),
  );
  const response = AuditLogPageResponseDto.from({
    items: [entry],
    total: 1,
    page: 1,
    limit: 20,
    counts: { ACCOUNT: 0, OPERATION: 0, SUBMISSION: 1, LOGIN: 0, SYSTEM: 0 },
  });
  const change: unknown = JSON.parse(JSON.stringify(response.items[0]?.change));

  expect(change).toEqual({ field: 'revision', before: null, after: '1' });
  expect(validate(change)).toEqual({
    valid: true,
    errors: null,
  });
});

it.each([null, 'value', 0, 1.5, true, false])(
  'accepts scalar change values %p in both fields',
  (value) => {
    expect(validate({ field: 'scalar', before: value, after: value })).toEqual({
      valid: true,
      errors: null,
    });
  },
);

it.each([
  { field: 'before', value: [] },
  { field: 'before', value: {} },
  { field: 'after', value: [] },
  { field: 'after', value: {} },
])('rejects composite change value $value in $field', ({ field, value }) => {
  expect(
    validate({ field: 'scalar', before: null, after: null, [field]: value }),
  ).toMatchObject({ valid: false });
});
