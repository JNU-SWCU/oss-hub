import { Controller, Get, Param } from '@nestjs/common';
import { PublicUserProfileResponseDto } from './dto/public-user-profile-response.dto';
import { PublicProjectsService } from './public-projects.service';

/**
 * 익명 공개 read 프로필. 마지막 세그먼트를 `public-profile`로 두어
 * `/users/me/profile`(SessionGuard 보호, `UsersModule`)과 어떤 등록 순서에서도 겹치지
 * 않는다(#551). NestJS/Express는 컨트롤러를 모듈 등록 순서대로 매칭하므로 두 경로가
 * 같은 자리에서 겹치면 `AppModule`의 import 한 줄 순서가 곧 라우팅 계약이 되고,
 * 순서가 바뀌는 순간 `me`가 `:userId`로 흡수돼 인증 없는 공개 응답이 내 프로필 경로를
 * 가로챈다. Express 5(path-to-regexp v8)는 `:param` 정규식 제약을 더 이상 지원하지
 * 않아 경로를 겹치지 않게 두는 것이 유일한 순서 무관 해법이다.
 * 회귀 고정: `public-user-profile-route.http.spec.ts`(두 등록 순서 모두 검증).
 */
@Controller('users')
export class PublicUserProfileController {
  constructor(private readonly publicProjectsService: PublicProjectsService) {}

  @Get(':userId/public-profile')
  async findProfile(
    @Param('userId') userId: string,
  ): Promise<PublicUserProfileResponseDto> {
    return PublicUserProfileResponseDto.from(
      await this.publicProjectsService.findProfile(userId),
    );
  }
}
