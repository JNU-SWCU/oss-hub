import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { PreviousPageButton, RouteNotice } from './_shell/route-notice';

export default function NotFound() {
  return (
    <RouteNotice
      title="페이지를 찾을 수 없습니다"
      description="주소가 바뀌었거나 삭제된 화면일 수 있습니다. 주소를 다시 확인하거나 아래에서 이동해 주세요."
      code="404"
      actions={
        <>
          <Button asChild className="min-h-11" size="sm">
            <Link href="/programs">프로그램 목록으로</Link>
          </Button>
          <PreviousPageButton />
        </>
      }
    />
  );
}
