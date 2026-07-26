import { Controller, Get, Header, Param } from '@nestjs/common';
import { type PublicProfileResponseDto } from './dto/public-profile-response.dto';
import { PublicProfileService } from './public-profile.service';

@Controller('users')
export class PublicProfileController {
  constructor(private readonly publicProfileService: PublicProfileService) {}

  @Get(':userId/public-profile')
  @Header('Cache-Control', 'public, max-age=60')
  findPublicProfile(
    @Param('userId') userId: string,
  ): Promise<PublicProfileResponseDto> {
    return this.publicProfileService.findPublicProfile(userId);
  }
}
