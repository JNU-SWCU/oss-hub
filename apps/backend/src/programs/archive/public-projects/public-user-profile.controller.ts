import { Controller, Get, Header, Param } from '@nestjs/common';
import { Public } from '../../../auth/controller/auth-route-metadata';
import { PublicUserProfileResponseDto } from './dto/public-user-profile-response.dto';
import { PublicProjectsService } from './public-projects.service';

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
