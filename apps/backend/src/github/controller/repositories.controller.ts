import {
  Controller,
  Get,
  Header,
  Inject,
  Req,
  UseGuards,
} from '@nestjs/common';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { MyRepositoriesResponseDto } from './dto/my-repositories-response.dto';
import { RepositoriesService } from './repositories.service';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('repositories')
export class RepositoriesController {
  constructor(
    @Inject(RepositoriesService)
    private readonly repositoriesService: Pick<
      RepositoriesService,
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
