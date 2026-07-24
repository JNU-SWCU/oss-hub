import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import {
  EditableProgramResponseDto,
  ProgramMilestoneResponseDto,
} from './dto/editable-program-response.dto';
import { UpdateProgramRequestDto } from './dto/update-program-request.dto';
import { UpsertMilestoneRequestDto } from './dto/upsert-milestone-request.dto';
import { ProgramEditorService } from './program-editor.service';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('programs')
export class ProgramEditorController {
  constructor(private readonly editor: ProgramEditorService) {}

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
