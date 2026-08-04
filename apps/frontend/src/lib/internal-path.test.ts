import { describe, expect, it } from 'vitest';
import { isInternalPath, toInternalPath } from './internal-path';

describe('isInternalPath', () => {
  it.each([
    ['루트', '/'],
    ['일반 경로', '/dashboard'],
    ['쿼리가 붙은 경로', '/programs?status=open'],
    ['fragment가 붙은 경로', '/archive#list'],
    ['퍼센트 인코딩된 경로', '/profile/%EA%B9%80'],
  ])('%s는 내부 경로로 인정한다', (_label, input) => {
    expect(isInternalPath(input)).toBe(true);
  });

  // 여기부터가 이 검증기의 존재 이유다. 아래 형태가 하나라도 통과하면 우리
  // 도메인에서 출발해 남의 사이트에 착지하는 open redirect가 열린다.
  it.each([
    ['절대 URL(https)', 'https://evil.example/login'],
    ['절대 URL(http)', 'http://evil.example'],
    ['프로토콜 상대 URL', '//evil.example'],
    ['프로토콜 상대 URL + 경로', '//evil.example/pwn'],
    ['역슬래시 우회', '/\\evil.example'],
    ['역슬래시 두 개', '\\\\evil.example'],
    ['경로 중간의 역슬래시', '/dashboard\\@evil.example'],
    ['javascript 스킴', 'javascript:alert(1)'],
    ['data 스킴', 'data:text/html,<script>alert(1)</script>'],
    ['스킴 상대 표기', 'evil.example/login'],
    ['앞에 공백이 붙은 절대 URL', ' https://evil.example'],
    ['빈 문자열', ''],
  ])('%s는 거부한다', (_label, input) => {
    expect(isInternalPath(input)).toBe(false);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['숫자', 1],
    ['객체', { toString: () => '/dashboard' }],
    ['배열', ['/dashboard']],
  ])('%s처럼 문자열이 아닌 값은 거부한다', (_label, input) => {
    expect(isInternalPath(input)).toBe(false);
  });
});

describe('toInternalPath', () => {
  it('통과한 값은 그대로 돌려준다', () => {
    expect(toInternalPath('/dashboard', '/')).toBe('/dashboard');
  });

  it.each([
    ['외부 URL', 'https://evil.example'],
    ['프로토콜 상대 URL', '//evil.example'],
    ['역슬래시 우회', '/\\evil.example'],
    ['빠진 값', undefined],
  ])('%s는 fallback으로 되돌린다', (_label, input) => {
    expect(toInternalPath(input, '/signup')).toBe('/signup');
  });
});
