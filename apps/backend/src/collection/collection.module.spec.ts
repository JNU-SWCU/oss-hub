import { MODULE_METADATA } from '@nestjs/common/constants';
import { ScheduleModule } from '@nestjs/schedule';

import { CollectionModule } from './collection.module';

describe('CollectionModule', () => {
  it('ScheduleModule을 초기화한다', () => {
    const imports: unknown = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      CollectionModule,
    );

    expect(Array.isArray(imports)).toBe(true);
    if (!Array.isArray(imports)) {
      return;
    }

    expect(
      imports.some(
        (entry: unknown) =>
          typeof entry === 'object' &&
          entry !== null &&
          'module' in entry &&
          entry.module === ScheduleModule,
      ),
    ).toBe(true);
  });
});
