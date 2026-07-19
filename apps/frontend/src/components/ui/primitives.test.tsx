import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button } from './button';
import { Input } from './input';
import { Field, FieldLabel, FieldDescription } from './field';
import { Card, CardContent, CardHeader, CardTitle } from './card';
import { Alert, AlertDescription, AlertTitle } from './alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './table';

// shadcn/ui 프리미티브 6종(Button/Input/Field=FormField/Card/Alert/Table)이
// 실제로 import·렌더 가능함을 증명하는 최소 스모크 테스트.
describe('shadcn/ui primitives', () => {
  it('renders all 6 primitives without throwing', () => {
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
      </>,
    );

    expect(html).toContain('버튼');
    expect(html).toContain('카드');
    expect(html).toContain('알림');
    expect(html).toContain('값');
  });
});
