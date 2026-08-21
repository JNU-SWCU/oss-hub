// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LegacyMemberReclassificationScreen } from './components/legacy-member-reclassification-screen';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  configurable: true,
  value: true,
});

let container: HTMLDivElement;
let root: Root;
let requests: readonly Record<string, unknown>[];
const onComplete = vi.fn();

beforeEach(() => {
  requests = [];
  onComplete.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const parsed: unknown =
        typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      const body = record(parsed);
      requests = [...requests, body];
      return new Response(
        JSON.stringify({
          memberKind: body.memberKind,
          hasStaffAccess: body.memberKind === 'STAFF',
          hasAdminAccess: true,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }),
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('submits the complete STUDENT self-reclassification and refreshes session', async () => {
  // Given
  await act(async () => {
    root.render(<LegacyMemberReclassificationScreen onComplete={onComplete} />);
  });

  // When
  await select('legacy-member-kind', 'STUDENT');
  await type('profile-name', '  합성 학생 관리자  ');
  await type('profile-student-id', '770001');
  await select('profile-department', '인공지능학부');
  await submit();

  // Then
  expect(requests).toEqual([
    {
      memberKind: 'STUDENT',
      name: '합성 학생 관리자',
      studentId: '770001',
      affiliationKind: 'DEPARTMENT',
      affiliationName: '인공지능학부',
    },
  ]);
  expect(onComplete).toHaveBeenCalledTimes(1);
});

it('STAFF flow omits the student-ID control and request field', async () => {
  // Given
  await act(async () => {
    root.render(<LegacyMemberReclassificationScreen onComplete={onComplete} />);
  });

  // When
  await select('legacy-member-kind', 'STAFF');
  await type('profile-name', '합성 교직원 관리자');
  await select('profile-affiliation-kind', 'PROGRAM_OFFICE');
  await type('profile-affiliation-name', '합성 사업단');
  await submit();

  // Then
  expect(container.querySelector('#profile-student-id')).toBeNull();
  expect(requests).toEqual([
    {
      memberKind: 'STAFF',
      name: '합성 교직원 관리자',
      affiliationKind: 'PROGRAM_OFFICE',
      affiliationName: '합성 사업단',
    },
  ]);
});

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Expected request body object');
  }
  return Object.fromEntries(Object.entries(value));
}

async function type(id: string, value: string): Promise<void> {
  const element = container.querySelector(`#${id}`);
  if (!(element instanceof HTMLInputElement)) {
    throw new TypeError(`Input not found: ${id}`);
  }
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;
  await act(async () => {
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function select(id: string, value: string): Promise<void> {
  const element = container.querySelector(`#${id}`);
  if (!(element instanceof HTMLSelectElement)) {
    throw new TypeError(`Select not found: ${id}`);
  }
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    'value',
  )?.set;
  await act(async () => {
    setter?.call(element, value);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function submit(): Promise<void> {
  const form = container.querySelector('form');
  await act(async () => {
    form?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  });
}
