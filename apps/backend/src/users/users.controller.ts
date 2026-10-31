import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../platform/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { UpdateMyProfileRequestDto } from './dto/update-my-profile-request.dto';
import { UserProfileResponseDto } from './dto/user-profile-response.dto';
import { UsersService } from './users.service';
import { Protected } from '../auth/auth-route.decorator';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('users/me/profile')
export class UsersController {
  constructor(
    @Inject(UsersService)
    private readonly usersService: Pick<
      UsersService,
      | 'getMyProfile'
      | 'completeMyProfile'
      | 'patchMyProfile'
      | 'profileInputFromRequest'
    >,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  async getMyProfile(
    @Req() request: SessionIdentity,
  ): Promise<UserProfileResponseDto> {
    return UserProfileResponseDto.from(
      await this.usersService.getMyProfile(request.sessionGithubId),
    );
  }

  @Post()
  @Protected()
  @UseGuards(OriginGuard)
  async completeMyProfile(
    @Req() request: SessionIdentity,
    @Body() body: UpdateMyProfileRequestDto,
  ): Promise<UserProfileResponseDto> {
    return UserProfileResponseDto.from(
      await this.usersService.completeMyProfile(
        request.sessionGithubId,
        this.usersService.profileInputFromRequest(body),
      ),
    );
  }

  @Patch()
  @Protected()
  @UseGuards(OriginGuard)
  async patchMyProfile(
    @Req() request: SessionIdentity,
    @Body() body: UpdateMyProfileRequestDto,
  ): Promise<UserProfileResponseDto> {
    return UserProfileResponseDto.from(
      await this.usersService.patchMyProfile(
        request.sessionGithubId,
        this.usersService.profileInputFromRequest(body),
      ),
    );
  }
}
