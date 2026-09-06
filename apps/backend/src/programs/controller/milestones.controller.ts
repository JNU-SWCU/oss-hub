import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { OriginGuard } from '../../auth/origin.guard';
import {
  type AuthenticatedRequest,
  SessionGuard,
} from '../../auth/session.guard';
import {
  ProgramMilestoneEditResponseDto,
  ProgramMilestoneResponseDto,
} from '../dto/editable-program-response.dto';
import { UpdateMilestoneRequestDto } from '../dto/update-milestone-request.dto';
import { UpsertMilestoneRequestDto } from '../dto/upsert-milestone-request.dto';
import { ProgramEditorService } from '../service/program-editor.service';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;
const bodyValidationPipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

@Controller('milestones')
@UseGuards(SessionGuard, OriginGuard)
export class MilestonesController {
  constructor(private readonly editor: ProgramEditorService) {}

  @Get(':id/edit')
  async edit(
    @Req() request: SessionIdentity,
    @Param('id') id: string,
  ): Promise<ProgramMilestoneEditResponseDto> {
    return ProgramMilestoneEditResponseDto.from(
      await this.editor.getMilestoneEdit(request.sessionGithubId, id),
    );
  }

  @Patch(':id')
  async update(
    @Req() request: SessionIdentity,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ProgramMilestoneEditResponseDto | ProgramMilestoneResponseDto> {
    if (!isRecord(body)) {
      throw new BadRequestException('Milestone update body must be an object.');
    }
    // EXPAND-only dual dispatch for independent frontend/backend deployment; CONTRACT deletes this seam.
    if ('expectedFingerprint' in body || 'documents' in body) {
      const input: unknown = await bodyValidationPipe.transform(body, {
        metatype: UpdateMilestoneRequestDto,
        type: 'body',
      });
      if (!(input instanceof UpdateMilestoneRequestDto)) {
        throw new BadRequestException(
          'Invalid aggregate milestone update body.',
        );
      }
      return ProgramMilestoneEditResponseDto.from(
        await this.editor.updateMilestoneEdit(
          request.sessionGithubId,
          id,
          input,
        ),
      );
    }
    const input: unknown = await bodyValidationPipe.transform(body, {
      metatype: UpsertMilestoneRequestDto,
      type: 'body',
    });
    if (!(input instanceof UpsertMilestoneRequestDto)) {
      throw new BadRequestException('Invalid legacy milestone update body.');
    }
    return ProgramMilestoneResponseDto.from(
      await this.editor.updateMilestone(request.sessionGithubId, id, input),
    );
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
