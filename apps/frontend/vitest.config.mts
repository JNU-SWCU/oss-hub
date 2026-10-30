import path from 'node:path';
import { createRequire } from 'node:module';
import { defaultExclude, defineConfig } from 'vitest/config';

const happyDomTests = [
  'src/features/programs/catalog/queries.test.tsx',
  'src/app/_shell/query-provider.test.tsx',
  'src/lib/navigation-notices.test.tsx',
  'e2e/support/confirmation-cancel-label.test.tsx',
  'src/app/error.test.tsx',
  'src/app/_shell/{app-frame-drawer.test.tsx,app-frame.login-destination.test.tsx,landing-entry-action.return-to.test.tsx,onboarding-gate.test.tsx,onboarding-rejection-reach.test.tsx,product-shell-countdown.interaction.test.tsx,product-shell-participant-menu.test.tsx,product-shell-ranking.test.tsx,program-scope-sidebar-keys.test.tsx,role-gate.test.tsx,route-notice.test.tsx,sidebar-drawer.test.tsx,sign-in-entries.test.tsx,use-product-shell-data.test.tsx,use-session-role.test.tsx,zero-surface-member-classification.test.tsx,zero-surface-member-reach.test.tsx}',
  'src/app/onboarding/pending/role-request-count.test.tsx',
  'src/app/onboarding/role/role-selection-route.test.tsx',
  'src/app/programs/\\[id\\]/program-detail-screen.test.tsx',
  'src/app/programs/\\[id\\]/program-detail-view-consistency.test.tsx',
  'src/app/programs/\\[id\\]/apply/program-apply-route.test.tsx',
  'src/app/programs/\\[id\\]/documents/documents-route.test.tsx',
  'src/app/programs/\\[id\\]/edit/program-edit-route.test.tsx',
  'src/app/programs/\\[id\\]/teams/program-teams-route-view.test.tsx',
  'src/app/settings/{settings-notification-flow.test.tsx,settings-page.test.tsx}',
  'src/components/{data-table.test.tsx,dialog-shell.test.tsx,filter-chip.test.tsx,list-card.test.tsx,nav-bar-escape.test.tsx,table-scroll-region.test.tsx}',
  'src/components/program/{program-countdown.interaction.test.tsx,program-cover.test.tsx}',
  'src/components/ui/dialog.test.tsx',
  'src/features/audit-log/audit-log-screen.test.tsx',
  'src/features/auth/login-destination.test.ts',
  'src/features/auth/components/{github-sign-in-link.test.tsx,login-button.logout.test.tsx}',
  'src/features/board/components/{board-delete-list-refetch.test.tsx,board-field-focus.test.tsx}',
  'src/features/consents/components/{consent-flow-navigation.test.tsx,consent-required-dialog.test.tsx}',
  'src/features/dashboard/{pending-invite-reach.test.tsx,student-dashboard-screen.test.tsx,student-dashboard-sections.test.tsx}',
  'src/features/landing/cosmos/cosmos-interaction.test.ts',
  'src/features/landing/{landing-focus.test.ts,landing-journey-focus.test.tsx,landing-reveal.test.tsx}',
  'src/features/profile/{profile-onboarding-consent.test.tsx,profile-onboarding-screen.test.tsx}',
  'src/features/profile/settings/account-deactivation-section.test.tsx',
  'src/features/programs/applications/{application-confirmation-dialog.test.tsx,application-decision-dialog.test.tsx,application-team-departure.test.tsx,program-apply-invitation-search.test.tsx,program-apply-page-initialization.test.tsx,program-apply-page.test.tsx,student-rejection-reach.test.tsx}',
  'src/features/programs/catalog/{archived-program-reach.test.tsx,program-detail-anchor-scroll.test.tsx,program-detail-page.test.tsx,program-detail-summary.interaction.test.tsx,program-human-first-contract.test.tsx,program-list-page.test.tsx}',
  'src/features/programs/documents/{milestone-disclosure.test.tsx,milestone-document-collection-review-flow.test.tsx,milestone-document-collection-screen.test.tsx,milestone-document-editor.test.tsx,milestone-document-file-recovery.test.tsx,milestone-document-list.test.tsx,milestone-document-resubmission-dialog.test.tsx,milestone-document-submission-form.test.tsx,milestone-grouping.test.tsx,milestone-submission-block.test.tsx,program-document-archive-panel.test.tsx,program-document-change-request-panel.test.tsx}',
  'src/features/programs/authoring/{program-authoring-milestone-step.test.tsx,program-authoring-operations-step.test.tsx,program-authoring-shell.test.tsx,program-authoring-submission-item.test.tsx,program-cover-field.test.tsx,program-creation-page.test.tsx,program-deadline-control.test.tsx,program-edit-danger-zone-section.test.tsx,program-edit-delete-control-distinction.test.tsx,program-edit-flow-end-at.test.tsx,program-edit-flow-notify-round-trip.test.tsx,program-edit-local-apply.test.tsx,program-edit-milestone-cache.test.tsx,program-edit-milestone-delete-dialog.test.tsx,program-edit-milestone-dialog.test.tsx,program-edit-milestone-snapshot.test.tsx,program-edit-milestone-start-at.test.ts,program-edit-page.test.tsx,program-form-input-labels.test.tsx,program-notice-import-dialog.test.tsx,program-schedule-range-calendar.test.tsx,program-schedule-range-editor.test.tsx,use-program-cover-edit.test.tsx}',
  'src/features/programs/teams/{program-my-team-page.test.tsx,program-staff-team-detail-page.test.tsx,program-staff-teams-page.test.tsx,program-teams-page.test.tsx,repository-url-editor.test.tsx,repository-url-history.test.tsx,staff-team-members-panel.test.tsx,team-activity-graph.test.tsx,team-delete-dialog.test.tsx,team-invitation-notifications.test.tsx,team-invite-panel-combobox.test.tsx,team-invite-panel.test.tsx,team-members-panel.test.tsx,team-repository-panel.test.tsx,use-team-invitation-management.test.tsx}',
  'src/features/programs/catalog/components/activity-graph-panel.test.tsx',
  'src/features/ranking/components/ranking-screen.test.tsx',
  'src/features/reviews/{submission-review-conflict.test.tsx,submission-review-refresh.test.tsx,submission-review-request-order.test.tsx,submission-review-screen.test.tsx}',
  'src/features/reviews/components/repository-publish-card.test.tsx',
  'src/features/roles/access-administration/{admin-access-authority-actions.test.tsx,admin-access-detail-actions.test.tsx,admin-access-detail-dialogs.test.tsx,admin-access-detail-history.test.tsx,admin-access-detail-layout.test.tsx,admin-access-detail-post-decision.test.tsx,admin-access-detail-view.test.tsx,admin-access-list-interactive.test.tsx,admin-access-mutation-actions.test.tsx,admin-access-revocation-contract.test.tsx}',
  'src/features/roles/onboarding/role-request-retry.test.tsx',
  'src/features/roles/access-administration/components/{admin-access-overlay.test.tsx,admin-access-profile-section.test.tsx}',
  'src/features/submissions/{milestone-document-current-files.test.tsx,submission-checklist-clock.test.tsx,submission-dialog.test.tsx,submission-input.test.tsx,submission-matrix-controls.test.tsx,submission-matrix-stage-navigation.test.tsx,submission-submit-feedback.test.tsx}',
  'src/features/system-status/components/{collection-activity-feed.test.tsx,collection-streams-table.test.tsx,external-collection-section.test.tsx,system-status-screen.test.tsx}',
  'src/lib/{use-debounced-value.test.tsx,use-file-check.test.tsx}',
];

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': createRequire(import.meta.url).resolve(
        'next/dist/compiled/server-only/empty',
      ),
    },
  },
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          exclude: [...defaultExclude, 'e2e/**/*.spec.ts', ...happyDomTests],
        },
      },
      {
        extends: true,
        test: {
          name: 'happy-dom',
          environment: 'happy-dom',
          include: happyDomTests,
        },
      },
    ],
  },
});
