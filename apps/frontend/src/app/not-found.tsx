import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { PreviousPageButton, RouteNotice } from './_shell/route-notice';

/**
 * 라우트 트리에 없는 주소가 도착하는 자리 (#1103).
 *
 * 이 파일이 없으면 `<html lang="ko">` 껍데기 안에 Next 기본 영어 화면이 그대로
 * 들어앉는다. 상단 바에는 OSS Hub가 남아 있으므로 사용자는 서비스가 고장 난 것인지
 * 주소가 틀린 것인지 구분할 단서가 없고, 돌아갈 링크도 없어 뒤로가기 말고 할 수 있는
 * 일이 없다.
 *
 * 갈 곳은 둘이다 — 역할과 무관하게 같은 화면인 `/programs`, 그리고 원래 있던 자리.
 * `/dashboard`는 쓰지 않는다(사유는 `PreviousPageButton` 주석).
 */
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
