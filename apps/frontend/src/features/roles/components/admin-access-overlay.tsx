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
  const base = accessDetailPath(workspace, userId);
  return `a[href="${base}"], a[href^="${base}?"]`;
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
