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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './table';

describe('shadcn/ui primitives', () => {
  it('renders all 7 primitives without throwing', () => {
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
  });
});
