import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../../auth/origin.guard';
import {
  type AuthenticatedRequest,
  SessionGuard,
} from '../../auth/session.guard';
import { MyRepositoriesResponseDto } from '../dto/my-repositories-response.dto';
import {
  ChangeRepositoryConnectionRequestDto,
  ChangeRepositoryConnectionResponseDto,
} from '../dto/change-repository-connection.dto';
import { RepositoryConnectionsService } from '../service/repository-connections.service';
import { RepositoriesService } from '../service/repositories.service';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('repositories')
export class RepositoriesController {
  constructor(
    @Inject(RepositoriesService)
    private readonly repositoriesService: Pick<
      RepositoriesService,
      'getMyRepositories'
    >,
    @Inject(RepositoryConnectionsService)
    private readonly repositoryConnectionsService: Pick<
      RepositoryConnectionsService,
      'changeConnection'
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

  @Patch(':applicationId/connection')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(SessionGuard, OriginGuard)
  async changeConnection(
    @Req() request: SessionIdentity,
    @Param('applicationId') applicationId: string,
    @Body() body: ChangeRepositoryConnectionRequestDto,
  ): Promise<ChangeRepositoryConnectionResponseDto> {
    return ChangeRepositoryConnectionResponseDto.from(
      await this.repositoryConnectionsService.changeConnection({
        applicationId,
        actorGithubId: request.sessionGithubId,
        mode: body.mode,
        url: body.url ?? null,
      }),
    );
  }
}
