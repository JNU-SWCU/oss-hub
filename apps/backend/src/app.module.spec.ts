import { MODULE_METADATA } from '@nestjs/common/constants';

import { AppModule } from './app.module';
import { RankingModule } from './ranking/ranking.module';

describe('AppModule public ranking exposure', () => {
  it('공개 적격성 projection 전에는 RankingModule을 노출하지 않는다', () => {
    const imports: unknown = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      AppModule,
    );

    expect(Array.isArray(imports)).toBe(true);
    if (!Array.isArray(imports)) {
      return;
    }

    expect(imports).not.toContain(RankingModule);
  });
});
