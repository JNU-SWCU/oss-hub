'use client';

import { Search } from 'lucide-react';
import type { FormEvent, ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const FILTER_ROW =
  'grid w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end';

export interface TeamSearchFormProps {
  readonly inputId: string;
  readonly search: string;
  readonly resettable: boolean;
  readonly compact?: boolean;
  readonly onSearchChange: (value: string) => void;
  readonly onSearch: () => void;
  readonly onReset: () => void;
}

export function TeamSearchForm(props: TeamSearchFormProps): ReactElement {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    props.onSearch();
  };
  const input = (
    <Input
      id={props.inputId}
      className={
        props.compact ? 'h-control min-w-0 flex-1' : 'h-control w-full min-w-0'
      }
      value={props.search}
      onChange={(event) => props.onSearchChange(event.target.value)}
      placeholder="신청자·팀명·GitHub ID"
    />
  );

  if (props.compact) {
    return (
      <form
        className="flex w-full min-w-0 items-center gap-2 sm:max-w-sm"
        onSubmit={submit}
      >
        <label htmlFor={props.inputId} className="sr-only">
          검색
        </label>
        {input}
        <Button type="submit" variant="outline" size="sm" className="h-control">
          조회
        </Button>
        {props.resettable ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-control"
            onClick={props.onReset}
          >
            초기화
          </Button>
        ) : null}
      </form>
    );
  }

  return (
    <form className={FILTER_ROW} onSubmit={submit}>
      <div className="flex w-full min-w-0 flex-col gap-2">
        <label
          htmlFor={props.inputId}
          className="inline-flex items-center gap-2 text-small font-semibold"
        >
          <Search aria-hidden="true" className="size-4 text-muted-foreground" />
          검색
        </label>
        {input}
      </div>
      <div className="flex w-full min-w-0 gap-2">
        <Button type="submit" className="h-control flex-1 sm:flex-none">
          조회
        </Button>
        {props.resettable ? (
          <Button
            type="button"
            variant="outline"
            className="h-control flex-1 sm:flex-none"
            onClick={props.onReset}
          >
            초기화
          </Button>
        ) : null}
      </div>
    </form>
  );
}
