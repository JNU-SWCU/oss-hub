import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHELL_BREAKPOINT_PX } from './shell-breakpoint';

describe('SHELL_BREAKPOINT_PX', () => {
  it('globals.css의 --breakpoint-shell 토큰과 같은 값이다', () => {
    const css = readFileSync(path.resolve(__dirname, '../globals.css'), 'utf8');
    expect(css).toContain(`--breakpoint-shell: ${SHELL_BREAKPOINT_PX}px;`);
  });
});
