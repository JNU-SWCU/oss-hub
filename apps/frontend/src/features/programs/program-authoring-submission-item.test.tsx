// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProgramAuthoringRequirement } from './program-authoring-model';
import { ProgramAuthoringSubmissionItem } from './program-authoring-submission-item';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

describe('ProgramAuthoringSubmissionItem', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('shows a 1,048,576-byte attachment as 1 MB', async () => {
    const requirement: ProgramAuthoringRequirement = {
      id: 'requirement-1',
      name: '계획서',
      required: true,
      templateFile: {
        name: '계획서.pdf',
        size: 1024 * 1024,
        type: 'application/pdf',
        requiresReselection: false,
      },
    };

    await act(async () => {
      root.render(
        <ProgramAuthoringSubmissionItem
          milestoneId="milestone-1"
          requirement={requirement}
          reorderHandle={<span />}
          onFileChange={() => undefined}
          onRemove={() => undefined}
          onRequiredChange={() => undefined}
          onNameChange={() => undefined}
        />,
      );
    });

    expect(container.textContent).toContain('계획서.pdf · 1 MB');
    expect(container.textContent).not.toContain('MiB');
  });
});
