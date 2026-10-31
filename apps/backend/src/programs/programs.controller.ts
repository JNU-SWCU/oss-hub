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
  ProgramCoverService,
  ProgramCreationService,
} from './program-creation.service';
import { OriginGuard } from '../platform/origin.guard';
import {
  type AuthenticatedRequest,
  type OptionalSessionRequest,
} from '../auth/http-auth.types';
import { DeleteProgramResponseDto } from './dto/delete-program-response.dto';
import { PurgeProgramResponseDto } from './dto/purge-program-response.dto';
import {
  EditableProgramResponseDto,
  ProgramMilestoneResponseDto,
} from './dto/editable-program-response.dto';
import { UpdateProgramRequestDto } from './dto/program-authoring-request.dto';
import { UpsertMilestoneRequestDto } from './dto/upsert-milestone-request.dto';
import { ProgramEditorService } from './program-editor.service';
import { PurgeProgramRequestDto } from './dto/purge-program-request.dto';
import { ProgramLifecycleService } from './program-lifecycle.service';
import { ProgramViewerRequestDto } from './dto/program-viewer-request.dto';
import { CreateProgramRequestDto } from './dto/create-program-request.dto';
import { CreateProgramResponseDto } from './dto/create-program-response.dto';
import {
  ProgramDetailResponseDto,
  ProgramActivityResponseDto,
} from './dto/program-detail-response.dto';
import { ProgramListRequestDto } from './dto/program-list-request.dto';
import { ProgramEndedYearsResponseDto } from './dto/program-ended-years-response.dto';
import { ProgramListPageResponseDto } from './dto/program-list-response.dto';
import { ProgramStatusCountsResponseDto } from './dto/program-status-counts-response.dto';
import { ProgramActivityService } from './program-activity.service';
import { ProgramsService } from './programs.service';
import {
  Public,
  Protected,
  OptionalSession,
} from '../auth/auth-route.decorator';
import { STAFF_AUDIENCE } from '../platform/roles.guard';
import { Roles } from '../platform/roles.decorator';
import { DomainException } from '../platform/error-code.error';
import {
  PROGRAM_ERROR_CODES,
  ProgramErrorCode,
} from './program-error-code.error';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

const ANONYMOUS_VIEWER = {
  githubId: null,
  userId: null,
  role: null,
} as const;

const createForbidden = () =>
  new DomainException(PROGRAM_ERROR_CODES[ProgramErrorCode.FORBIDDEN]);

const deleteForbidden = () =>
  new DomainException(
    PROGRAM_ERROR_CODES[ProgramErrorCode.PROGRAM_DELETE_FORBIDDEN],
  );

@Controller('programs')
@Protected()
export class ProgramsController {
  constructor(
    private readonly creation: ProgramCreationService,
    private readonly programs: ProgramsService,
    private readonly activity: ProgramActivityService,
    private readonly covers: ProgramCoverService,
    private readonly lifecycle: ProgramLifecycleService,
    private readonly editor: ProgramEditorService,
  ) {}

  @Get()
  @OptionalSession()
  async list(
    @Query() query: ProgramListRequestDto,
    @Req() request: OptionalSessionRequest,
  ): Promise<ProgramListPageResponseDto> {
    return ProgramListPageResponseDto.from(
      await this.programs.listFromRequest(query, request.auth),
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
  @Protected()
  @Roles(STAFF_AUDIENCE, createForbidden)
  @UseGuards(OriginGuard)
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
    return ProgramDetailResponseDto.from(
      await this.programs.detail(programId, ANONYMOUS_VIEWER),
    );
  }

  @Get(':id/viewer')
  @Protected()
  async viewerDetail(
    @Param('id') programId: string,
    @Req() request: SessionIdentity,
    @Query() query: ProgramViewerRequestDto = {},
  ): Promise<ProgramDetailResponseDto> {
    return ProgramDetailResponseDto.from(
      await this.programs.detailForGithubId(
        programId,
        request.sessionGithubId,
        query,
      ),
    );
  }

  @Get(':id/activity')
  @Protected()
  async programActivity(
    @Param('id') programId: string,
    @Req() request: SessionIdentity,
  ): Promise<readonly ProgramActivityResponseDto[]> {
    return (
      await this.activity.activityForGithubId(
        programId,
        request.sessionGithubId,
      )
    ).map((result) => ProgramActivityResponseDto.from(result));
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
  @Protected()
  @Roles(STAFF_AUDIENCE, deleteForbidden)
  @UseGuards(OriginGuard)
  async purge(
    @Param('id') programId: string,
    @Body() body: PurgeProgramRequestDto,
    @Req() request: SessionIdentity,
  ): Promise<PurgeProgramResponseDto> {
    return PurgeProgramResponseDto.from(
      await this.lifecycle.purge(
        request.sessionGithubId,
        programId,
        body.expectedScope,
      ),
    );
  }

  @Delete(':id')
  @Protected()
  @Roles(STAFF_AUDIENCE, deleteForbidden)
  @UseGuards(OriginGuard)
  async delete(
    @Param('id') programId: string,
    @Req() request: SessionIdentity,
  ): Promise<DeleteProgramResponseDto> {
    return DeleteProgramResponseDto.from(
      await this.lifecycle.delete(request.sessionGithubId, programId),
    );
  }

  @Get(':id/edit')
  @Protected()
  async get(
    @Req() request: SessionIdentity,
    @Param('id') id: string,
  ): Promise<EditableProgramResponseDto> {
    const program = await this.editor.getProgram(request.sessionGithubId, id);
    return EditableProgramResponseDto.from(program);
  }

  @Patch(':id')
  @Protected()
  @UseGuards(OriginGuard)
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
  @Protected()
  @UseGuards(OriginGuard)
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
