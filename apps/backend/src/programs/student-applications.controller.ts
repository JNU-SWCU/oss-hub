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
import { OriginGuard } from '../platform/origin.guard';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { MyStudentApplicationResponseDto } from './dto/my-student-application-response.dto';
import { UpdateStudentApplicationRequestDto } from './dto/update-student-application-request.dto';
import {
  StudentApplicationCancellationResponseDto,
  StudentApplicationResponseDto,
} from './dto/student-application-response.dto';
import { StudentApplicationManagementService } from './student-application-management.service';
import { Protected } from '../auth/auth-route.decorator';

type StudentApplicationRequest = Pick<AuthenticatedRequest, 'sessionGithubId'>;

@Controller('programs/:programId/applications/me')
@Protected()
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
  ): Promise<MyStudentApplicationResponseDto> {
    const application = await this.service.getMine(
      request.sessionGithubId,
      programId,
    );
    return MyStudentApplicationResponseDto.from(
      application ? StudentApplicationResponseDto.from(application) : null,
    );
  }

  @Patch()
  @UseGuards(OriginGuard)
  async updateMine(
    @Req() request: StudentApplicationRequest,
    @Param('programId') programId: string,
    @Body() body: UpdateStudentApplicationRequestDto,
  ): Promise<StudentApplicationResponseDto> {
    return StudentApplicationResponseDto.from(
      await this.service.updateMine(
        request.sessionGithubId,
        programId,
        body.toInput(),
      ),
    );
  }

  @Delete()
  @UseGuards(OriginGuard)
  async cancelMine(
    @Req() request: StudentApplicationRequest,
    @Param('programId') programId: string,
  ): Promise<StudentApplicationCancellationResponseDto> {
    return StudentApplicationCancellationResponseDto.from(
      await this.service.cancelMine(request.sessionGithubId, programId),
    );
  }
}
