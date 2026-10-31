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
import { OriginGuard } from '../platform/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import {
  ProgramMilestoneEditResponseDto,
  ProgramMilestoneResponseDto,
} from './dto/editable-program-response.dto';
import { DeletedResponseDto } from './dto/deleted-response.dto';
import { UpdateMilestoneRequestDto } from './dto/update-milestone-request.dto';
import { UpsertMilestoneRequestDto } from './dto/upsert-milestone-request.dto';
import {
  ProgramEditorService,
  type MilestoneUpdateCommand,
} from './program-editor.service';
import { Protected } from '../auth/auth-route.decorator';

type SessionIdentity = Pick<AuthenticatedRequest, 'sessionGithubId'>;

const bodyValidationPipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});

export const milestoneUpdatePipe = {
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
  },
} satisfies PipeTransform<unknown, Promise<MilestoneUpdateCommand>>;

@Controller('milestones')
@Protected()
@UseGuards(OriginGuard)
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
    @Body(milestoneUpdatePipe) command: MilestoneUpdateCommand,
  ): Promise<ProgramMilestoneEditResponseDto | ProgramMilestoneResponseDto> {
    const updated = await this.editor.updateMilestoneByCommand(
      request.sessionGithubId,
      id,
      command,
    );
    return updated.kind === 'aggregate'
      ? ProgramMilestoneEditResponseDto.from(updated.result)
      : ProgramMilestoneResponseDto.from(updated.result);
  }

  @Delete(':id')
  async delete(
    @Req() request: SessionIdentity,
    @Param('id') id: string,
  ): Promise<DeletedResponseDto> {
    await this.editor.deleteMilestone(request.sessionGithubId, id);
    return DeletedResponseDto.from();
  }
}
