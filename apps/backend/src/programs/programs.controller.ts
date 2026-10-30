import {
  Controller,
  Get,
  Header,
  Param,
  StreamableFile,
  Body,
  Patch,
  Post,
  Req,
  UseGuards,
  Delete,
  HttpCode,
  Query,
} from '@nestjs/common';
import {
  Public,
  Protected,
  OptionalSession,
} from '../auth/auth-route-metadata.policy';
import {
  ProgramCoverService,
  ProgramCreationService,
} from './program-creation.service';
import { OriginGuard } from '../auth/origin.guard';
import {
  type AuthenticatedRequest,
  HTTP_AUTH_KINDS,
  type OptionalSessionRequest,
} from '../auth/http-auth.types';
import { SessionGuard } from '../auth/session.guard';
import {
  EditableProgramResponseDto,
  ProgramMilestoneResponseDto,
} from './dto/editable-program-response.dto';
import { UpdateProgramRequestDto } from './dto/program-authoring-request.dto';
import { UpsertMilestoneRequestDto } from './dto/upsert-milestone-request.dto';
import { ProgramEditorService } from './program-editor.service';
import { PurgeProgramRequestDto } from './dto/purge-program-request.dto';
import { ProgramLifecycleService } from './program-lifecycle.service';
import { ProgramViewerQueryRequestDto } from './dto/program-viewer-query.dto';
import { CreateProgramRequestDto } from './dto/create-program-request.dto';
import { CreateProgramResponseDto } from './dto/create-program-response.dto';
import {
  programDetailResponse,
  programActivityResponse,
  type ProgramActivityResponseDto,
  type ProgramDetailResponseDto,
} from './dto/program-detail.dto';
import { ProgramListQueryRequestDto } from './dto/program-list-query.dto';
import { ProgramEndedYearsResponseDto } from './dto/program-ended-years-response.dto';
import { ProgramListPageResponseDto } from './dto/program-list-response.dto';
import { ProgramStatusCountsResponseDto } from './dto/program-status-counts-response.dto';
import { ProgramActivityService } from './program-activity.service';
import { ProgramViewerService } from './program-viewer.service';
import { ProgramsService } from './programs.service';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

const ANONYMOUS_VIEWER = {
  githubId: null,
  userId: null,
  role: null,
} as const;

@Controller('programs')
@Protected()
export class ProgramsController {
  constructor(
    private readonly creation: ProgramCreationService,
    private readonly programs: ProgramsService,
    private readonly activity: ProgramActivityService,
    private readonly viewers: ProgramViewerService,
    private readonly covers: ProgramCoverService,
    private readonly lifecycle: ProgramLifecycleService,
    private readonly editor: ProgramEditorService,
  ) {}

  @Get()
  @OptionalSession()
  async list(
    @Query() query: ProgramListQueryRequestDto,
    @Req() request: OptionalSessionRequest,
  ): Promise<ProgramListPageResponseDto> {
    const githubId =
      request.auth.kind === HTTP_AUTH_KINDS.AUTHENTICATED
        ? request.auth.principal.githubId
        : null;
    const viewer = await this.viewers.fromGithubId(githubId);
    return ProgramListPageResponseDto.from(
      await this.programs.list(query.toQuery(), viewer),
    );
  }

  @Get('status-counts')
  @Public()
  async statusCounts(): Promise<ProgramStatusCountsResponseDto> {
    return ProgramStatusCountsResponseDto.from(
      await this.programs.statusCounts(),
    );
  }

  @Get('ended-years')
  @OptionalSession()
  async endedYears(): Promise<ProgramEndedYearsResponseDto> {
    return ProgramEndedYearsResponseDto.from(await this.programs.endedYears());
  }

  @Post()
  @HttpCode(201)
  @UseGuards(SessionGuard, OriginGuard)
  async create(
    @Req() request: SessionIdentity,
    @Body() input: CreateProgramRequestDto,
  ): Promise<CreateProgramResponseDto> {
    const program = await this.creation.create(request.sessionGithubId, input);
    return CreateProgramResponseDto.from(program);
  }

  @Get(':id')
  @Public()
  async detail(
    @Param('id') programId: string,
  ): Promise<ProgramDetailResponseDto> {
    return programDetailResponse(
      await this.programs.detail(programId, ANONYMOUS_VIEWER),
    );
  }

  @Get(':id/viewer')
  @UseGuards(SessionGuard)
  async viewerDetail(
    @Param('id') programId: string,
    @Req() request: SessionIdentity,
    @Query() query: ProgramViewerQueryRequestDto = {},
  ): Promise<ProgramDetailResponseDto> {
    return programDetailResponse(
      await this.programs.detail(
        programId,
        await this.viewers.fromGithubId(
          request.sessionGithubId,
          programId,
          query.view === 'operations',
        ),
      ),
    );
  }

  @Get(':id/activity')
  @UseGuards(SessionGuard)
  async programActivity(
    @Param('id') programId: string,
    @Req() request: SessionIdentity,
  ): Promise<readonly ProgramActivityResponseDto[]> {
    return (
      await this.activity.activity(
        programId,
        await this.viewers.fromGithubId(request.sessionGithubId),
      )
    ).map(programActivityResponse);
  }

  @Get(':id/cover/:coverId')
  @Public()
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async cover(
    @Param('id') programId: string,
    @Param('coverId') coverId: string,
  ): Promise<StreamableFile> {
    const cover = await this.covers.read(programId, coverId);
    return new StreamableFile(cover.body, {
      type: cover.contentType,
      length: cover.size,
      disposition: 'inline',
    });
  }

  @Delete(':id/purge')
  @UseGuards(SessionGuard, OriginGuard)
  purge(
    @Param('id') programId: string,
    @Body() body: PurgeProgramRequestDto,
    @Req() request: SessionIdentity,
  ) {
    return this.lifecycle.purge(
      request.sessionGithubId,
      programId,
      body.expectedScope,
    );
  }

  @Delete(':id')
  @UseGuards(SessionGuard, OriginGuard)
  delete(
    @Param('id') programId: string,
    @Req() request: SessionIdentity,
  ): Promise<{ readonly id: string; readonly deleted: true }> {
    return this.lifecycle.delete(request.sessionGithubId, programId);
  }

  @Get(':id/edit')
  @UseGuards(SessionGuard)
  async get(
    @Req() request: SessionIdentity,
    @Param('id') id: string,
  ): Promise<EditableProgramResponseDto> {
    const program = await this.editor.getProgram(request.sessionGithubId, id);
    return EditableProgramResponseDto.from(program);
  }

  @Patch(':id')
  @UseGuards(SessionGuard, OriginGuard)
  async update(
    @Req() request: SessionIdentity,
    @Param('id') id: string,
    @Body() input: UpdateProgramRequestDto,
  ): Promise<EditableProgramResponseDto> {
    const program = await this.editor.updateProgram(
      request.sessionGithubId,
      id,
      input,
    );
    return EditableProgramResponseDto.from(program);
  }

  @Post(':id/milestones')
  @UseGuards(SessionGuard, OriginGuard)
  async createMilestone(
    @Req() request: SessionIdentity,
    @Param('id') id: string,
    @Body() input: UpsertMilestoneRequestDto,
  ): Promise<ProgramMilestoneResponseDto> {
    const milestone = await this.editor.createMilestone(
      request.sessionGithubId,
      id,
      input,
    );
    return ProgramMilestoneResponseDto.from(milestone);
  }
}
