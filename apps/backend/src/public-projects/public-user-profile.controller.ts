import { Controller, Get, Header, Param } from '@nestjs/common';
import { PublicUserProfileResponseDto } from './dto/public-user-profile-response.dto';
import { PublicProjectsService } from './public-projects.service';

/**
 * todo 16 — `/users/me/profile`(SessionGuard 보호, `UsersModule`)과 경로가 겹친다.
 * NestJS/Express는 컨트롤러를 모듈 등록 순서대로 매칭하므로 `AppModule`의 `imports`에서
 * `UsersModule`이 이 모듈보다 앞서야 `me`가 `:userId`로 흡수되지 않는다.
 */
@Controller('users')
export class PublicUserProfileController {
  constructor(private readonly publicProjectsService: PublicProjectsService) {}

  @Get(':userId/profile')
  @Header('Cache-Control', 'public, max-age=60')
  async findProfile(
    @Param('userId') userId: string,
  ): Promise<PublicUserProfileResponseDto> {
    return PublicUserProfileResponseDto.from(
      await this.publicProjectsService.findProfile(userId),
    );
  }
}
