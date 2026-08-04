import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OriginGuard } from '../auth/origin.guard';
import { type AuthenticatedRequest, SessionGuard } from '../auth/session.guard';
import { UpdateStudentApplicationRequestDto } from './dto/update-student-application-request.dto';
import {
  StudentApplicationManagementService,
  type StudentApplicationView,
} from './student-application-management.service';

type StudentApplicationRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

interface StudentApplicationResponse {
  readonly id: string;
  readonly programId: string;
  readonly status: StudentApplicationView['status'];
  readonly teamId: string | null;
  readonly answers: StudentApplicationView['answers'];
  readonly submittedAt: string;
  readonly updatedAt: string;
  readonly isRepositoryPublicationPlanned: boolean;
  readonly canManage: boolean;
  /** @deprecated Use canManage. */
  readonly canEdit: boolean;
  /** @deprecated Use canManage. */
  readonly canCancel: boolean;
}

function toResponse(
  application: StudentApplicationView,
): StudentApplicationResponse {
  return {
    ...application,
    canEdit: application.canManage,
    canCancel: application.canManage,
    submittedAt: application.submittedAt.toISOString(),
    updatedAt: application.updatedAt.toISOString(),
  };
}

@Controller('programs/:programId/applications/me')
@UseGuards(SessionGuard)
export class StudentApplicationsController {
  constructor(
    @Inject(StudentApplicationManagementService)
    private readonly service: Pick<
      StudentApplicationManagementService,
      'getMine' | 'updateMine' | 'cancelMine'
    >,
  ) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  async getMine(
    @Req() request: StudentApplicationRequest,
    @Param('programId') programId: string,
  ): Promise<StudentApplicationResponse> {
    return toResponse(
      await this.service.getMine(request.sessionGithubId, programId),
    );
  }

  @Patch()
  @UseGuards(OriginGuard)
  async updateMine(
    @Req() request: StudentApplicationRequest,
    @Param('programId') programId: string,
    @Body() body: UpdateStudentApplicationRequestDto,
  ): Promise<StudentApplicationResponse> {
    return toResponse(
      await this.service.updateMine(
        request.sessionGithubId,
        programId,
        body.toInput(),
      ),
    );
  }

  @Delete()
  @UseGuards(OriginGuard)
  cancelMine(
    @Req() request: StudentApplicationRequest,
    @Param('programId') programId: string,
  ): Promise<{ readonly cancelled: true }> {
    return this.service.cancelMine(request.sessionGithubId, programId);
  }
}
