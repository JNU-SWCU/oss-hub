import { Controller, Get, Header, Param } from '@nestjs/common';
import { PublicUserProfileResponseDto } from './dto/public-user-profile-response.dto';
import { PublicProjectsService } from './public-projects.service';
import { Public } from '../auth/auth-route.decorator';

@Controller('users')
@Public()
export class PublicUserProfileController {
  constructor(private readonly publicProjectsService: PublicProjectsService) {}

  @Get(':userId/public-profile')
  @Header('Cache-Control', 'no-store')
  async findProfile(
    @Param('userId') userId: string,
  ): Promise<PublicUserProfileResponseDto> {
    return PublicUserProfileResponseDto.from(
      await this.publicProjectsService.findProfile(userId),
    );
  }
}
