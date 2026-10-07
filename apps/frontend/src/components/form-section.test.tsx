import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormSection } from './form-section';
import { Field, FieldError, FieldLabel } from './ui/field';
import { Input } from './ui/input';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';

describe('FormSection', () => {
  it('renders a titled section with description and field slots', () => {
    const html = renderToStaticMarkup(
      <FormSection
        title="기본 정보"
        description="프로그램 이름과 소개를 입력하세요."
      >
        <Field>
          <FieldLabel htmlFor="name">프로그램 이름</FieldLabel>
          <Input id="name" />
        </Field>
      </FormSection>,
    );

    expect(html).toContain('기본 정보');
    expect(html).toContain('프로그램 이름과 소개를 입력하세요.');
    expect(html).toContain('프로그램 이름');
  });

  it('omits the description slot when none is given', () => {
    const html = renderToStaticMarkup(
      <FormSection title="추가 정보">
        <Field>
          <FieldLabel htmlFor="note">비고</FieldLabel>
          <Input id="note" />
        </Field>
      </FormSection>,
    );

    expect(html).toContain('추가 정보');
    expect(html).not.toContain('field-description');
  });

  it('composes field-level validation error and global success/server-error alerts from existing primitives', () => {
    const html = renderToStaticMarkup(
      <>
        <Alert>
          <AlertTitle>제출 완료</AlertTitle>
          <AlertDescription>신청이 정상적으로 접수됐습니다.</AlertDescription>
        </Alert>

        <FormSection title="팀 정보" description="팀 구성원을 입력하세요.">
          <Field data-invalid="true">
            <FieldLabel htmlFor="team-name">팀 이름</FieldLabel>
            <Input id="team-name" aria-invalid />
            <FieldError>팀 이름을 입력해 주세요.</FieldError>
          </Field>
        </FormSection>

        <Alert variant="destructive">
          <AlertTitle>제출 실패</AlertTitle>
          <AlertDescription>
            서버 오류로 신청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.
          </AlertDescription>
        </Alert>
      </>,
    );

    expect(html).toContain('제출 완료');

    expect(html).toContain('팀 이름을 입력해 주세요.');
    expect(html).toContain('role="alert"');

    expect(html).toContain(
      '서버 오류로 신청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    );
  });
});
