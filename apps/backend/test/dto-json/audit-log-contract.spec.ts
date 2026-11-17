import * as Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AuditLogPageResponseDto } from '../../src/admin/dto/audit-log-page-response.dto';
import { auditRow } from '../../src/platform/audit-log-mapping.fixture';
import { SubmissionAuditSourceService } from '../../src/platform/submission-audit-source.service';

const document: unknown = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../../verify/openapi.baseline.json'),
    'utf8',
  ),
);
if (typeof document !== 'object' || document === null)
  throw new TypeError('OpenAPI baseline must be an object');
const validateChange = new Ajv({ nullable: true, allErrors: true })
  .addSchema(document, 'openapi')
  .compile({ $ref: 'openapi#/components/schemas/AuditChangeResponseDto' });

function validate(value: unknown) {
  return { valid: validateChange(value), errors: validateChange.errors };
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
