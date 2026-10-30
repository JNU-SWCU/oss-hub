import {
  Controller,
  Get,
  Header,
  Inject,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { SessionGuard } from '../auth/session.guard';
import { MyRepositoriesResponseDto } from './dto/my-repositories-response.dto';
import { RepositoriesReadService } from './repositories-read.service';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('repositories')
export class RepositoriesController {
  constructor(
    @Inject(RepositoriesReadService)
    private readonly repositoriesService: Pick<
      RepositoriesReadService,
      'getMyRepositories'
    >,
  ) {}

  @Get('me')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard)
  async getMyRepositories(
    @Req() request: SessionIdentity,
  ): Promise<MyRepositoriesResponseDto> {
    return MyRepositoriesResponseDto.from(
      await this.repositoriesService.getMyRepositories(request.sessionGithubId),
    );
  }
}
