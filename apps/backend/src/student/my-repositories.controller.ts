import { Controller, Get, Header, Inject, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { MyRepositoriesResponseDto } from './dto/my-repositories-response.dto';
import { RepositoriesReadService } from '../github/repositories-read.service';
import { Protected } from '../auth/authentication.guard';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('repositories')
export class MyRepositoriesController {
  constructor(
    @Inject(RepositoriesReadService)
    private readonly repositoriesService: Pick<
      RepositoriesReadService,
      'getMyRepositories'
    >,
  ) {}

  @Get('me')
  @Header('Cache-Control', 'private, no-store')
  @Protected()
  async getMyRepositories(
    @Req() request: SessionIdentity,
  ): Promise<MyRepositoriesResponseDto> {
    return MyRepositoriesResponseDto.from(
      await this.repositoriesService.getMyRepositories(request.sessionGithubId),
    );
  }
}
