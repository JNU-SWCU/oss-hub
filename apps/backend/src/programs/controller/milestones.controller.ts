import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { ProgramMilestoneResponseDto } from './dto/editable-program-response.dto';
import { UpsertMilestoneRequestDto } from './dto/upsert-milestone-request.dto';
import { ProgramEditorService } from './program-editor.service';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('milestones')
@UseGuards(SessionGuard, OriginGuard)
export class MilestonesController {
  constructor(private readonly editor: ProgramEditorService) {}

  @Patch(':id')
  async update(
    @Req() request: SessionIdentity,
    @Param('id') id: string,
    @Body() input: UpsertMilestoneRequestDto,
  ): Promise<ProgramMilestoneResponseDto> {
    const milestone = await this.editor.updateMilestone(
      request.sessionGithubId,
      id,
      input,
    );
    return ProgramMilestoneResponseDto.from(milestone);
  }

  @Delete(':id')
  async delete(
    @Req() request: SessionIdentity,
    @Param('id') id: string,
  ): Promise<{ readonly deleted: true }> {
    await this.editor.deleteMilestone(request.sessionGithubId, id);
    return { deleted: true };
  }
}
