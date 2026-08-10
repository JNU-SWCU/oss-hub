import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProgramAuthoringRepositoryControl } from './program-authoring-repository-control';

describe('ProgramAuthoringRepositoryControl', () => {
  it('shows the approved issuance choices and external visibility boundary', () => {
    const html = renderToStaticMarkup(
      <ProgramAuthoringRepositoryControl
        enabled
        onEnabledChange={() => undefined}
      />,
    );

    expect(html).toContain('GitHub 저장소 발급');
    expect(html).toContain('새 저장소 발급받기');
    expect(html).toContain('내 저장소 연결하기');
    expect(html).toContain('외부 저장소는 공개 저장소만 연결');
    expect(html).toContain('checked=""');
  });
});
