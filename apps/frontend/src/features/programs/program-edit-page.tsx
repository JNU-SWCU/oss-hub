'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { type EditableProgram, getEditableProgram, updateProgram } from './api';
import {
  buildProgramEditInput,
  type ProgramEditForm,
  toProgramEditForm,
} from './program-edit-flow';
import { PROGRAM_TEMPLATE_DEFINITIONS } from './program-templates';

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'ready'; readonly program: EditableProgram };

export function ProgramEditPage({ programId }: { readonly programId: string }) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [form, setForm] = useState<ProgramEditForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    getEditableProgram(programId)
      .then((program) => {
        if (!active) return;
        setState({ kind: 'ready', program });
        setForm(toProgramEditForm(program));
      })
      .catch(() => {
        if (active) {
          setState({
            kind: 'failed',
            message: '프로그램을 불러오지 못했습니다.',
          });
        }
      });
    return () => {
      active = false;
    };
  }, [programId]);

  const template = useMemo(
    () =>
      PROGRAM_TEMPLATE_DEFINITIONS.find(
        (item) => item.category === form?.category,
      ),
    [form?.category],
  );
  const requiresTeam = template?.template.participation === 'team';

  if (state.kind === 'loading' || form === null) {
    return <p className="text-sm text-muted-foreground">불러오는 중입니다.</p>;
  }
  if (state.kind === 'failed') {
    return <p className="text-sm text-destructive">{state.message}</p>;
  }

  const update = (key: keyof ProgramEditForm, value: string | boolean) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setError(null);
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (requiresTeam && (!form.teamMinSize || !form.teamMaxSize)) {
      setError('팀 프로그램은 최소/최대 팀 인원이 필요합니다.');
      return;
    }
    setSaving(true);
    try {
      const updated = await updateProgram(
        programId,
        buildProgramEditInput(form, requiresTeam),
      );
      setState({ kind: 'ready', program: updated });
      setForm(toProgramEditForm(updated));
    } catch {
      setError('저장하지 못했습니다. 입력값을 확인해 주세요.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto grid w-full max-w-4xl gap-4 px-4 py-6">
      <header className="grid gap-1">
        <h1 className="text-3xl font-bold tracking-tight">프로그램 편집</h1>
        <p className="text-sm text-muted-foreground">{state.program.name}</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>기본 정보</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-5" onSubmit={submit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="program-name">프로그램명</FieldLabel>
                <Input
                  id="program-name"
                  value={form.name}
                  onChange={(event) => update('name', event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="program-organizer">주관 기관</FieldLabel>
                <Input
                  id="program-organizer"
                  value={form.organizer}
                  onChange={(event) => update('organizer', event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="program-category">유형</FieldLabel>
                <select
                  id="program-category"
                  className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
                  value={form.category}
                  onChange={(event) => {
                    const selected = PROGRAM_TEMPLATE_DEFINITIONS.find(
                      (item) => item.category === event.target.value,
                    );
                    if (selected) update('category', selected.category);
                  }}
                >
                  {PROGRAM_TEMPLATE_DEFINITIONS.map((item) => (
                    <option key={item.category} value={item.category}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="application-start">신청 시작</FieldLabel>
                  <Input
                    id="application-start"
                    type="datetime-local"
                    value={form.applicationStartAt}
                    onChange={(event) =>
                      update('applicationStartAt', event.target.value)
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="application-end">신청 종료</FieldLabel>
                  <Input
                    id="application-end"
                    type="datetime-local"
                    value={form.applicationEndAt}
                    onChange={(event) =>
                      update('applicationEndAt', event.target.value)
                    }
                  />
                </Field>
              </div>
              {requiresTeam ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="team-min">최소 팀 인원</FieldLabel>
                    <Input
                      id="team-min"
                      type="number"
                      min={1}
                      value={form.teamMinSize}
                      onChange={(event) =>
                        update('teamMinSize', event.target.value)
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="team-max">최대 팀 인원</FieldLabel>
                    <Input
                      id="team-max"
                      type="number"
                      min={1}
                      value={form.teamMaxSize}
                      onChange={(event) =>
                        update('teamMaxSize', event.target.value)
                      }
                    />
                  </Field>
                </div>
              ) : null}
              <Field>
                <FieldLabel htmlFor="program-description">설명</FieldLabel>
                <textarea
                  id="program-description"
                  className="min-h-28 rounded-lg border border-input bg-background px-2.5 py-2 text-sm"
                  value={form.description}
                  onChange={(event) =>
                    update('description', event.target.value)
                  }
                />
              </Field>
              <Field orientation="horizontal">
                <input
                  id="repository-provisioning"
                  type="checkbox"
                  checked={form.repositoryProvisioningEnabled}
                  onChange={(event) =>
                    update(
                      'repositoryProvisioningEnabled',
                      event.target.checked,
                    )
                  }
                />
                <FieldLabel htmlFor="repository-provisioning">
                  저장소 프로비저닝 사용
                </FieldLabel>
              </Field>
              <FieldError>{error}</FieldError>
              <div className="flex justify-end">
                <Button disabled={saving} type="submit">
                  {saving ? '저장 중' : '저장'}
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
