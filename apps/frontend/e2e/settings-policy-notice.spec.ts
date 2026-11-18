import { writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { installBrowserAudit } from './support/browser-audit';
import {
  CONSENTED_RESPONSE,
  fulfillJson,
  installSyntheticAuthority,
  type MemberAccessApiHandlers,
  type SyntheticAuthority,
} from './support/member-access-fixture';

const REMOVED_NOTICE_HEADING =
  '비공개 기여 집계와 랭킹 안내를 업데이트했습니다';

const NOTIFICATION_CHANNEL = {
  notificationEmail: 'synthetic-settings@example.com',
  notifyEnabled: true,
} as const;

const OUTDATED_CONSENT = {
  ...CONSENTED_RESPONSE,
  policyVersion: '2026-12-01',
  acceptedPolicyVersion: '2026-11-01',
} as const;

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

interface SettingsActor {
  readonly name: string;
  readonly label: string;
  readonly authority: SyntheticAuthority;
  readonly profile: {
    readonly githubLogin: string;
    readonly memberKind: 'STUDENT' | 'STAFF';
    readonly name: string;
    readonly studentId: string | null;
    readonly staffNumber: string | null;
    readonly department: string;
    readonly phone: string | null;
    readonly isComplete: true;
    readonly participations: readonly never[];
  };
}

const STUDENT: SettingsActor = {
  name: 'student',
  label: '학생',
  authority: {
    role: 'STUDENT',
    memberKind: 'STUDENT',
    hasStaffAccess: false,
    hasAdminAccess: false,
  },
  profile: {
    githubLogin: 'synthetic-settings-student',
    memberKind: 'STUDENT',
    name: '합성 학생 사용자',
    studentId: '260901',
    staffNumber: null,
    department: '인공지능학부',
    phone: null,
    isComplete: true,
    participations: [],
  },
};

const STAFF: SettingsActor = {
  name: 'staff',
  label: '교직원',
  authority: {
    role: 'STAFF',
    memberKind: 'STAFF',
    hasStaffAccess: true,
    hasAdminAccess: false,
  },
  profile: {
    githubLogin: 'synthetic-settings-staff',
    memberKind: 'STAFF',
    name: '합성 교직원 사용자',
    studentId: null,
    staffNumber: '260001',
    department: '소프트웨어공학과',
    phone: null,
    isComplete: true,
    participations: [],
  },
};

async function scrollSettings(
  page: Page,
  to: 'top' | 'end',
): Promise<readonly string[]> {
  return await page.evaluate((target) => {
    const owners = [...document.querySelectorAll<HTMLElement>('*')].filter(
      (element) =>
        /auto|scroll/.test(getComputedStyle(element).overflowY) &&
        element.scrollHeight > element.clientHeight,
    );
    for (const owner of owners) {
      owner.scrollTop = target === 'end' ? owner.scrollHeight : 0;
    }
    return owners.map(
      (owner) =>
        owner.tagName.toLowerCase() +
        (owner.dataset.slot ? `[data-slot=${owner.dataset.slot}]` : ''),
    );
  }, to);
}

function settingsApiHandlers(
  actor: SettingsActor,
  consent: unknown = CONSENTED_RESPONSE,
): MemberAccessApiHandlers {
  return {
    'GET /api/v1/consents/current': async (route) =>
      fulfillJson(route, consent),
    'GET /api/v1/users/me/profile': async (route) =>
      fulfillJson(route, actor.profile),
    'GET /api/v1/users/me/notification-email': async (route) =>
      fulfillJson(route, NOTIFICATION_CHANNEL),
    'GET /api/v1/team-invitations/received': async (route) =>
      fulfillJson(route, []),
  };
}

for (const actor of [STUDENT, STAFF]) {
  test(`${actor.label} 설정 화면은 중복 정책 안내 없이 설정 폼을 보여 준다`, async ({
    page,
  }, testInfo) => {
    const audit = installBrowserAudit(page);
    await installSyntheticAuthority(
      page,
      actor.authority,
      settingsApiHandlers(actor),
    );

    await page.goto('/settings');
    await expect(
      page.getByRole('heading', { name: '설정', exact: true }),
    ).toBeVisible();
    await expect(page.locator('#settings-name')).toHaveValue(
      actor.profile.name,
    );

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await expect(page.locator('#settings-notification-email')).toHaveValue(
        NOTIFICATION_CHANNEL.notificationEmail,
      );
      await expect(
        page.getByRole('button', { name: '저장', exact: true }),
      ).toBeVisible();
      await expect(page.getByText(REMOVED_NOTICE_HEADING)).toHaveCount(0);
      await expect(page.locator('#settings-policy-update-heading')).toHaveCount(
        0,
      );
      await expect(page.getByTestId('policy-notice')).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await scrollSettings(page, 'top');
      await page.screenshot({
        path: testInfo.outputPath(
          `settings-${actor.name}-${viewport.width}.png`,
        ),
        fullPage: true,
      });

      const scrollOwners = await scrollSettings(page, 'end');
      await writeFile(
        testInfo.outputPath(
          `scroll-owners-${actor.name}-${viewport.width}.json`,
        ),
        JSON.stringify(scrollOwners, null, 2),
      );
      await expect(page.getByText(REMOVED_NOTICE_HEADING)).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath(
          `settings-${actor.name}-${viewport.width}-end.png`,
        ),
        fullPage: true,
      });
    }

    audit.assertClean();
  });
}

test('이전 정책 버전에 동의한 계정은 정책 안내를 한 번만 받는다', async ({
  page,
}, testInfo) => {
  const audit = installBrowserAudit(page);
  await installSyntheticAuthority(
    page,
    STUDENT.authority,
    settingsApiHandlers(STUDENT, OUTDATED_CONSENT),
  );

  await page.goto('/settings');
  const notice = page.getByTestId('policy-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toHaveCount(1);
  await expect(
    notice.getByRole('heading', { name: '활동 수집 안내가 바뀌었습니다' }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('policy-notice-open.png'),
    fullPage: true,
  });

  await notice.getByRole('button', { name: '확인', exact: true }).click();
  await expect(notice).toHaveCount(0);
  await expect(page.locator('#settings-name')).toHaveValue(
    STUDENT.profile.name,
  );

  await page.reload();
  await expect(page.locator('#settings-name')).toHaveValue(
    STUDENT.profile.name,
  );
  await expect(notice).toHaveCount(0);
  await expect(page.getByText(REMOVED_NOTICE_HEADING)).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('policy-notice-after-reload.png'),
    fullPage: true,
  });

  audit.assertClean();
});

test('현재 정책 버전에 동의한 계정에는 정책 안내가 열리지 않는다', async ({
  page,
}, testInfo) => {
  const audit = installBrowserAudit(page);
  await installSyntheticAuthority(
    page,
    STUDENT.authority,
    settingsApiHandlers(STUDENT),
  );

  await page.goto('/settings');
  await expect(page.locator('#settings-name')).toHaveValue(
    STUDENT.profile.name,
  );
  await expect(page.getByTestId('policy-notice')).toHaveCount(0);
  await expect(page.getByText(REMOVED_NOTICE_HEADING)).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('policy-notice-current-version.png'),
    fullPage: true,
  });

  audit.assertClean();
});
