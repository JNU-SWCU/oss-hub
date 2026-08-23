import type { AuditLogService } from '../audit-log/audit-log.service';
import { DomainException } from '../common/error-code';
import { SystemErrorCode } from '../common/system-error-code.enum';
import { RolesErrorCode } from '../roles/roles-error-code.enum';
import { createAdminProfileAudit } from './admin-profile-audit';
import { requireActiveAdmin } from './admin-access-authorization';
import { roleError } from './admin-access-mutation-policy';
import { isValidStudentId } from './user-profile-policy';
import { USERS_ERROR_CODES, UsersErrorCode } from './users-error-code.enum';
import type {
  AdminProfileFields,
  AdminProfileUpdateCommand,
  AdminProfileUpdateResult,
} from './domain/admin-profile';
import type { AdminProfileRepositoryPort } from './admin-profile.repository.types';

type MutationDependencies = {
  readonly repository: AdminProfileRepositoryPort;
  readonly auditLog: AuditLogService;
};

type MutationInput = {
  readonly actorGithubId: bigint;
  readonly userId: string;
  readonly command: AdminProfileUpdateCommand;
};

/**
 * 관리자가 다른 사용자의 이름·학번·학과를 대신 고치는 트랜잭션 전체를 담당한다.
 *
 * 본인 경로(`users.service.ts`의 `patchMyProfile`)와 달리 `STUDENT_ID_IMMUTABLE`을
 * 적용하지 않는다 — 이미 값이 있는 학번도 관리자는 다른 값으로 덮어쓸 수 있다. 다만
 * 형식(`STUDENT_ID_PATTERN`)·"학번을 채우려면 학과가 필요하다" 규칙·`UserProfile.studentId`
 * 유일성은 두 경로 모두 지킨다.
 *
 * actor가 활성 ADMIN인지는 **이 트랜잭션 안에서** 판정한다(#687). 예전에는 서비스가
 * 트랜잭션 밖에서 한 번 읽고 넘겼는데, 그러면 읽은 뒤 트랜잭션이 열리고 쓰기가 끝날
 * 때까지가 통째로 창이 된다 — 그 사이에 강등된 관리자도 남의 학번·이름을 고치고 감사
 * 로그에 정상 actor로 남았다.
 */
export async function mutateAdminUserProfile(
  dependencies: MutationDependencies,
  input: MutationInput,
): Promise<AdminProfileUpdateResult> {
  return dependencies.repository.withTransaction(async (store) => {
    // 잠금 먼저, 판정은 그다음이다. 순서가 뒤집히면 잠기지 않은 낡은 값으로 판정하게 된다.
    await store.lockActiveAdmins();
    const actor = requireActiveAdmin(
      await store.findActor(input.actorGithubId),
    );
    const before = await store.findTarget(input.userId);
    if (!before) {
      throw roleError(RolesErrorCode.USER_NOT_FOUND);
    }

    if (
      input.command.studentId !== undefined &&
      !isValidStudentId(input.command.studentId)
    ) {
      throw new DomainException({
        code: SystemErrorCode.VALIDATION_FAILED,
        status: 400,
        message: '학번 형식이 올바르지 않습니다.',
      });
    }

    if (
      input.command.studentId !== undefined &&
      before.memberKind === 'STAFF'
    ) {
      throw new DomainException({
        code: SystemErrorCode.VALIDATION_FAILED,
        status: 400,
        message: '교직원 프로필에는 학번을 저장할 수 없습니다.',
      });
    }

    const nextName = input.command.name ?? before.name;
    const nextStudentId = input.command.studentId ?? before.studentId;
    const nextDepartment = input.command.department ?? before.department;

    if (nextStudentId !== null) {
      if (nextDepartment === null) {
        throw new DomainException(
          USERS_ERROR_CODES[UsersErrorCode.STUDENT_ID_NEEDS_DEPARTMENT],
        );
      }
      // UserProfile 행은 세 컬럼 모두 NOT NULL이다. 학과는 바로 위에서 이미 확인했으니
      // 남은 것은 이름 — 아직 온보딩을 마치지 않아 이름이 없는 사용자에게 학번부터
      // 채우려 하면 여기서 막는다(관리자도 이름 없는 UserProfile 행을 만들 수는 없다).
      if (nextName === null) {
        throw new DomainException({
          code: SystemErrorCode.VALIDATION_FAILED,
          status: 400,
          message: '학번을 저장하려면 이름이 먼저 있어야 합니다.',
        });
      }
      const outcome = await store.applyProfile(
        input.userId,
        {
          name: nextName,
          studentId: nextStudentId,
          department: nextDepartment,
        },
        {
          ...(input.command.name !== undefined
            ? { name: input.command.name }
            : {}),
          ...(input.command.studentId !== undefined
            ? { studentId: input.command.studentId }
            : {}),
          ...(input.command.department !== undefined
            ? { department: input.command.department }
            : {}),
        },
      );
      if (outcome === 'studentIdTaken') {
        throw new DomainException(
          USERS_ERROR_CODES[UsersErrorCode.STUDENT_ID_TAKEN_BY_ADMIN],
        );
      }
    } else {
      await store.applyLegacyFields(input.userId, {
        ...(input.command.name !== undefined
          ? { name: input.command.name }
          : {}),
        ...(input.command.department !== undefined
          ? { department: input.command.department }
          : {}),
      });
    }

    const after: AdminProfileFields = {
      name: nextName,
      studentId: nextStudentId,
      department: nextDepartment,
    };
    // 실제로 바뀐 필드가 없으면(요청 값이 기존 값과 같음) 감사 로그를 쓰지 않는다.
    const audit = createAdminProfileAudit({
      actor: { name: actor.name, githubLogin: actor.githubLogin },
      target: before,
      before,
      after,
    });
    if (audit) {
      await dependencies.auditLog.record(
        {
          actorGithubId: input.actorGithubId,
          action: audit.action,
          targetType: audit.targetType,
          targetId: audit.targetId,
          metadata: audit.metadata,
        },
        store.auditLogWriter,
      );
    }

    return { id: input.userId, ...after };
  });
}
