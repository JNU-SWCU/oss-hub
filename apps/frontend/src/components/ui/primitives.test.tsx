import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button } from './button';
import { Input } from './input';
import { Field, FieldLabel, FieldDescription } from './field';
import { Card, CardContent, CardHeader, CardTitle } from './card';
import { Alert, AlertDescription, AlertTitle } from './alert';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from './collapsible';
import { Dialog, DialogTrigger } from './dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './table';

describe('shadcn/ui primitives', () => {
  it('누를 수 있는 것에는 손 모양 커서가 뜬다', () => {
    /*
     * Tailwind v4 preflight 는 button 에 cursor: pointer 를 넣지 않는다.
     * 프리미티브가 직접 들지 않으면 앱의 모든 버튼이 화살표 커서가 된다.
     */
    const html = renderToStaticMarkup(<Button>확인</Button>);
    expect(html).toContain('cursor-pointer');
  });

  it('renders all 8 primitives without throwing', () => {
    const html = renderToStaticMarkup(
      <>
        <Button>버튼</Button>
        <Input placeholder="입력" />
        <Field>
          <FieldLabel htmlFor="demo">라벨</FieldLabel>
          <FieldDescription>설명</FieldDescription>
        </Field>
        <Card>
          <CardHeader>
            <CardTitle>카드</CardTitle>
          </CardHeader>
          <CardContent>내용</CardContent>
        </Card>
        <Alert>
          <AlertTitle>알림</AlertTitle>
          <AlertDescription>설명</AlertDescription>
        </Alert>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>열</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>값</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <Collapsible defaultOpen>
          <CollapsibleTrigger>접기 토글</CollapsibleTrigger>
          <CollapsibleContent>접을 수 있는 내용</CollapsibleContent>
        </Collapsible>
        <Dialog>
          <DialogTrigger>다이얼로그 열기</DialogTrigger>
        </Dialog>
      </>,
    );

    expect(html).toContain('버튼');
    expect(html).toContain('카드');
    expect(html).toContain('알림');
    expect(html).toContain('값');
    expect(html).toContain('data-slot="collapsible"');
    expect(html).toContain('data-slot="collapsible-trigger"');
    expect(html).toContain('data-slot="collapsible-content"');
    expect(html).toContain('접을 수 있는 내용');
    expect(html).toContain('data-slot="dialog-trigger"');
  });
});
