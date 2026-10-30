import {
  Body,
  BadRequestException,
  ValidationPipe,
  type PipeTransform,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { SessionGuard } from '../auth/session.guard';
import {
  ProgramMilestoneEditResponseDto,
  ProgramMilestoneResponseDto,
} from './dto/editable-program-response.dto';
import type { MilestoneUpdateCommand } from './program-write.types';
import { UpdateMilestoneRequestDto } from './dto/update-milestone-request.dto';
import { UpsertMilestoneRequestDto } from './dto/upsert-milestone-request.dto';
import { ProgramEditorService } from './program-editor.service';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

const bodyValidationPipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

export class MilestoneUpdatePipe implements PipeTransform<
  unknown,
  Promise<MilestoneUpdateCommand>
> {
  async transform(body: unknown): Promise<MilestoneUpdateCommand> {
    if (typeof body !== 'object' || body === null) {
      throw new BadRequestException('Milestone update body must be an object.');
    }
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
      return { kind: 'aggregate', input: { ...input } };
    }
    const input: unknown = await bodyValidationPipe.transform(body, {
      metatype: UpsertMilestoneRequestDto,
      type: 'body',
    });
    if (!(input instanceof UpsertMilestoneRequestDto)) {
      throw new BadRequestException('Invalid legacy milestone update body.');
    }
    return { kind: 'legacy', input: { ...input } };
  }
}

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
    @Body(new MilestoneUpdatePipe()) command: MilestoneUpdateCommand,
  ): Promise<ProgramMilestoneEditResponseDto | ProgramMilestoneResponseDto> {
    switch (command.kind) {
      case 'aggregate':
        return ProgramMilestoneEditResponseDto.from(
          await this.editor.updateMilestoneEdit(
            request.sessionGithubId,
            id,
            command.input,
          ),
        );
      case 'legacy':
        return ProgramMilestoneResponseDto.from(
          await this.editor.updateMilestone(
            request.sessionGithubId,
            id,
            command.input,
          ),
        );
    }
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
