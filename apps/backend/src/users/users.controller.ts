import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { UpdateMyProfileRequestDto } from './dto/update-my-profile-request.dto';
import { UserProfileResponseDto } from './dto/user-profile-response.dto';
import { UsersService } from './users.service';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('users/me/profile')
export class UsersController {
  constructor(
    @Inject(UsersService)
    private readonly usersService: Pick<
      UsersService,
      'getMyProfile' | 'patchMyProfile'
    >,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async getMyProfile(
    @Req() request: SessionIdentity,
  ): Promise<UserProfileResponseDto> {
    return UserProfileResponseDto.from(
      await this.usersService.getMyProfile(request.sessionGithubId),
    );
  }

  @Patch()
  @UseGuards(SessionGuard, OriginGuard)
  async patchMyProfile(
    @Req() request: SessionIdentity,
    @Body() body: UpdateMyProfileRequestDto,
  ): Promise<UserProfileResponseDto> {
    return UserProfileResponseDto.from(
      await this.usersService.patchMyProfile(
        request.sessionGithubId,
        body.toInput(),
      ),
    );
  }
}
