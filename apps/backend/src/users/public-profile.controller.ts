import { Controller, Get, Header, Param } from '@nestjs/common';
import { Public } from '../auth/auth-route-metadata.policy';
import { PublicUserProfileResponseDto } from './dto/public-profile-response.dto';
import { PublicProjectsService } from '../programs/public/public-projects/service/public-projects.service';

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
