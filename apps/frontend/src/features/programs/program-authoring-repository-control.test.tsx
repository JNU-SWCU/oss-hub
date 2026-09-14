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
    expect(html).not.toContain('내 저장소 연결하기');
    expect(html).toContain('변경 사유와 이력은 교직원에게 표시됩니다.');
    expect(html).toContain('checked=""');
    expect(html).toMatch(
      /data-slot="alert-description"[^>]*class="[^"]*break-keep/,
    );
  });
});
