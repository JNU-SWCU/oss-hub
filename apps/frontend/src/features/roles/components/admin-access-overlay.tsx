'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';

import {
  accessDetailPath,
  type AccessWorkspace,
} from '../admin-access-list-query';
import {
  ADMIN_ACCESS_OVERLAY_BREAKPOINT_PX,
  adminAccessOverlayContentClassName,
  adminAccessOverlayScrimClassName,
  selectAdminAccessOverlayVariant,
  type AdminAccessOverlayVariant,
} from '../admin-access-overlay-variant';
import { AdminAccessDetailView } from './admin-access-detail-view';

/**
 * 현재 뷰포트 폭에서 Sheet/Inspector 중 무엇을 그릴지 추적한다. 이 오버레이는
 * intercepting route를 통해서만(=이미 클라이언트 사이드 네비게이션이 일어난
 * 뒤) 마운트되므로 최초 렌더가 SSR로 실행될 일이 없고, `window` 동기 접근이
 * 안전하다(hero-graph.tsx의 `window.matchMedia` 사용도 같은 전제).
 */
function useAdminAccessOverlayVariant(): AdminAccessOverlayVariant {
  const [variant, setVariant] = useState<AdminAccessOverlayVariant>(() =>
    selectAdminAccessOverlayVariant(window.innerWidth),
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(
      `(min-width: ${ADMIN_ACCESS_OVERLAY_BREAKPOINT_PX}px)`,
    );
    const update = () =>
      setVariant(selectAdminAccessOverlayVariant(window.innerWidth));
    update();
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, []);

  return variant;
}

/**
 * `/admin/access` 목록 행을 소프트 클릭했을 때 열리는 읽기 전용 오버레이
 * (PR04F) — intercepting route `@modal/(.)users/[userId]`에서만 마운트된다.
 * 표준 URL(`/admin/access/users/[userId]`)은 그대로 유지되고, 하드 새로고침·
 * 직접 진입은 이 컴포넌트를 절대 거치지 않는다(그 경우 표준 페이지(PR04E)가
 * 그대로 렌더된다).
 *
 * 상세 내용은 `AdminAccessDetailView`(PR04E)를 그대로 재사용해 프로필·이력
 * 렌더링 로직을 중복하지 않는다. 닫힘(Escape·바깥 클릭·닫기 버튼·뒤로가기)은
 * 전부 `router.back()`(또는 브라우저 자체의 뒤로가기)으로 수렴한다. `open`
 * prop이 항상 `true`인 이유도 여기 있다: 실제 닫힘은 Radix 내부 상태가
 * 아니라 라우트 전환이 이 컴포넌트를 트리에서 들어내는 방식으로 일어난다.
 *
 * 포커스 복귀와 스크롤 보존은 둘 다 같은 실측 사실 하나에서 비롯한다: Escape·
 * 뒤로가기로 오버레이가 닫힐 때 목록(`children` 슬롯)이 URL의 searchParams를
 * 다시 읽어 데이터를 재요청·재렌더한다(리액트 참조를 들고 있으면 이미 분리된
 * 노드에 `.focus()`를 호출하는 꼴이라 조용히 무시되고, 로딩 스켈레톤→로드된
 * 표로 높이가 바뀌며 브라우저의 popstate 스크롤 복원만으로는 그 리플로우만큼
 * 밀린다). 그래서 마운트 시점 `document.activeElement` 참조 대신, 트리거
 * 행의 `href`(이미 prop으로 있는 `userId`로 재구성 가능)를 언마운트 뒤 짧게
 * 반복 조회해 포커스하고, 같은 반복 안에서 오버레이가 열릴 때의 셸 스크롤을
 * 계속 되돌린다 — 목록 재요청이 끝나기 전(행이 아직 DOM에 없는 로딩 중)에
 * 한 번만 시도하면 놓칠 수 있어서, 재요청이 끝날 시간을 벌 만큼(약 400ms)
 * 여러 번 재시도한다. 회원 셸의 스크롤 원본은 `#main-content`다.
 */
export function readProductShellScrollTop(): number {
  const scroller = document.getElementById('main-content');
  if (scroller === null) return window.scrollY;
  return scroller.scrollTop;
}

export function writeProductShellScrollTop(top: number): void {
  const scroller = document.getElementById('main-content');
  if (scroller === null) {
    window.scrollTo(0, top);
    return;
  }
  scroller.scrollTop = top;
}

function adminAccessOverlayTriggerSelector(
  workspace: AccessWorkspace,
  userId: string,
): string {
  return `a[href="${accessDetailPath(workspace, userId)}"]`;
}

const RESTORE_INTERVAL_MS = 50;
const RESTORE_TICKS = 8;

export function AdminAccessOverlay({
  userId,
  workspace,
}: {
  readonly userId: string;
  readonly workspace: AccessWorkspace;
}) {
  const router = useRouter();
  const variant = useAdminAccessOverlayVariant();
  const isQueue = workspace === 'queue';

  useEffect(() => {
    const scrollTopOnOpen = readProductShellScrollTop();
    const triggerSelector = adminAccessOverlayTriggerSelector(
      workspace,
      userId,
    );

    return () => {
      const restore = () => {
        const trigger = document.querySelector<HTMLElement>(triggerSelector);
        if (trigger && document.activeElement !== trigger) {
          // `preventScroll`이 없으면 브라우저가 포커스된 요소를 뷰포트 안으로
          // 스크롤시켜 버려서, 바로 아래의 셸 스크롤 복원이 무의미해진다(실측: 이
          // 옵션 없이는 오프셋이 200에서 0으로 되돌아갔다).
          trigger.focus({ preventScroll: true });
        }
        writeProductShellScrollTop(scrollTopOnOpen);
      };

      restore();
      let ticks = 0;
      const intervalId = window.setInterval(() => {
        restore();
        ticks += 1;
        if (ticks >= RESTORE_TICKS) {
          window.clearInterval(intervalId);
        }
      }, RESTORE_INTERVAL_MS);
    };
  }, [userId, workspace]);

  const close = () => router.back();

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={adminAccessOverlayScrimClassName()}
        />
        <DialogPrimitive.Content
          aria-modal="true"
          className={adminAccessOverlayContentClassName(variant)}
        >
          <DialogPrimitive.Title className="sr-only">
            {isQueue ? '가입 신청 상세' : '사용자 목록 상세'}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {isQueue
              ? '선택한 가입 신청의 프로필과 요청을 확인합니다.'
              : '선택한 사용자의 프로필과 요청·로그인 이력을 확인합니다.'}
          </DialogPrimitive.Description>
          <DialogPrimitive.Close asChild>
            <Button
              className="absolute top-3 right-3 z-10"
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="닫기"
            >
              <X aria-hidden="true" />
            </Button>
          </DialogPrimitive.Close>
          <AdminAccessDetailView
            userId={userId}
            layoutContext="overlay"
            workspace={workspace}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
