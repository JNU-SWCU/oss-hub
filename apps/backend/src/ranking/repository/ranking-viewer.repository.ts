import { Inject, Injectable } from '@nestjs/common';
import { AccountStatus, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  RANKING_VIEWER_TIERS,
  type RankingViewerTier,
} from '../domain/ranking';

/**
 * 랭킹 응답 계층을 판정하기 위한 **최소** 조회.
 *
 * `GET /ranking` 에는 가드가 없다(비로그인 200 이 계약이다). 그래서 세션이 있으면
 * 그 사람의 역할만 읽어 계층을 정한다 — 이 조회가 읽는 칸은 `role` 과
 * `accountStatus` 둘뿐이며, 이름·학번·이메일 같은 칸은 select 에 없다.
 *
 * `AuthService.getMe` 를 대신 쓰지 않는 이유는 그쪽이 프로필 전체
 * (`COMPATIBLE_PROFILE_SELECT` — 실명 포함)를 읽고 비활성 계정에 예외를 던지기
 * 때문이다. 공개 endpoint 는 세션이 무효해도 200 이어야 하므로 던지지 않는다.
 */
@Injectable()
export class RankingViewerRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findTier(githubId: bigint | null): Promise<RankingViewerTier> {
    if (githubId === null) return RANKING_VIEWER_TIERS.PUBLIC;

    const viewer = await this.prisma.user.findUnique({
      where: { githubId },
      // allowlist — 계층 판정에 필요한 칸만 읽는다.
      select: { role: true, accountStatus: true },
    });
    if (viewer === null) return RANKING_VIEWER_TIERS.PUBLIC;
    // 비활성 계정은 권한을 잃는다 — 실명을 볼 자격도 함께 잃는다.
    if (viewer.accountStatus !== AccountStatus.ACTIVE) {
      return RANKING_VIEWER_TIERS.PUBLIC;
    }
    return viewer.role === Role.STAFF || viewer.role === Role.ADMIN
      ? RANKING_VIEWER_TIERS.STAFF
      : RANKING_VIEWER_TIERS.PUBLIC;
  }
}
