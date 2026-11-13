import * as fs from 'node:fs';
import * as path from 'node:path';

import { Prisma } from '@prisma/client';

describe('수집 편입 큐 계약', () => {
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
});
