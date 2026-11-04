import { Controller, Get, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/http-auth.types';
import { Protected } from '../auth/auth-route.decorator';
import { ApplicationPreparationsService } from './application-preparations.service';
import { MyApplicationPreparationResponseDto } from './dto/my-application-preparation-response.dto';

@Controller('application-preparations')
@Protected()
export class ApplicationPreparationsController {
  constructor(private readonly service: ApplicationPreparationsService) {}

  @Get('programs/:programId/me')
  async get(
    @Req() request: AuthenticatedRequest,
  ): Promise<MyApplicationPreparationResponseDto> {
    return MyApplicationPreparationResponseDto.from(
      await this.service.get(request.sessionGithubId),
    );
  }
}
