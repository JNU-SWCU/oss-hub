import path from 'node:path';

export const programEntries = {
  applications: [
    'queries',
    'api',
    'dto',
    'application-confirmation-dialog',
    'application-decision-dialog',
    'application-decision-refetch',
    'application-presentation',
    'application-status-control',
    'application-team-departure',
    'application-wire',
    'form-renderer',
    'load-program-apply-context',
    'program-templates',
    'review-history-timeline',
    'student-application-api',
    'student-application-dto',
  ],
  authoring: [
    'queries',
    'dto',
    'program-authoring-graph-validation',
    'program-authoring-sortable-attachments',
    'program-authoring-submission-item',
    'program-edit-flow',
    'program-end-at',
    'seoul-date-time',
  ],
  catalog: [
    'list-queries',
    'queries',
    'api',
    'dto',
    'program-detail-format',
    'program-list',
    'program-list-options',
    'program-list-pagination',
  ],
  documents: [
    'queries',
    'components/milestone-row',
    'milestone-document-dto',
    'milestone-document-editor',
    'milestone-document-editor-flow',
    'milestone-document-list',
    'milestone-document-pointer',
    'milestone-document-upload-policy',
    'milestone-submission-access',
  ],
  teams: [
    'queries',
    'api',
    'dto',
    'program-teams-flow',
    'team-invite-panel',
    'team-members-panel',
    'use-team-invitation-management',
  ],
  'staff-dashboard': ['queries'],
};

const entries = {
  programs: programEntries,
  roles: { onboarding: [], 'access-administration': [] },
};

function scope(file) {
  const match = file
    .replaceAll(path.sep, '/')
    .match(/\/src\/features\/(programs|roles)\/([^/]+)\/(.+)$/);
  return match
    ? {
        feature: match[1],
        owner: match[2],
        module: match[3].replace(/\.[cm]?[jt]sx?$/, ''),
      }
    : null;
}

export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      internal:
        '{{owner}} 내부 모듈 대신 명시된 업무 진입점을 사용한다 (apps/frontend/eslint-rules/feature-ownership.mjs): {{module}}',
    },
  },
  create(context) {
    const filename = context.physicalFilename ?? context.filename;
    if (
      /\.(test|spec|fixture)\.|-test-(fixtures|support)\.|-test-fixture\./.test(
        filename,
      )
    )
      return {};
    const source = scope(filename);
    if (!source || !entries[source.feature]?.[source.owner]) return {};
    const srcRoot = filename.slice(
      0,
      filename.replaceAll(path.sep, '/').lastIndexOf('/src/') + 5,
    );
    function check(node) {
      if (!node || typeof node.value !== 'string') return;
      const specifier = node.value;
      const targetPath = specifier.startsWith('@/')
        ? path.resolve(srcRoot, specifier.slice(2))
        : specifier.startsWith('.')
          ? path.resolve(path.dirname(filename), specifier)
          : null;
      const target = targetPath === null ? null : scope(targetPath);
      if (
        !target ||
        target.feature !== source.feature ||
        target.owner === source.owner
      )
        return;
      if (entries[target.feature]?.[target.owner]?.includes(target.module))
        return;
      context.report({
        node,
        messageId: 'internal',
        data: { owner: target.owner, module: target.module },
      });
    }
    return {
      ImportDeclaration(node) {
        check(node.source);
      },
      ExportNamedDeclaration(node) {
        check(node.source);
      },
      ExportAllDeclaration(node) {
        check(node.source);
      },
      ImportExpression(node) {
        check(node.source);
      },
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require')
          check(node.arguments[0]);
      },
    };
  },
};
