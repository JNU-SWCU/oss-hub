import { Controller, Get } from '@nestjs/common';
import { ApplicationTemplateListResponseDto } from './dto/application-template-response.dto';
import { Public } from '../auth/auth-route.decorator';
import { ProgramTemplatesService } from './program-templates.service';

@Controller('programs/application-templates')
@Public()
export class ApplicationTemplatesController {
  constructor(
    private readonly programTemplatesService: ProgramTemplatesService,
  ) {}

  @Get()
  list(): ApplicationTemplateListResponseDto {
    return ApplicationTemplateListResponseDto.from(
      this.programTemplatesService.listProgramTemplates(),
    );
  }
}
