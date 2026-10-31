import { Controller, Get } from '@nestjs/common';
import { ApplicationTemplateListResponseDto } from './dto/application-template-response.dto';
import { Public } from '../auth/authentication.guard';
import { listProgramTemplates } from './programs.service';

@Controller('programs/application-templates')
@Public()
export class ApplicationTemplatesController {
  @Get()
  list(): ApplicationTemplateListResponseDto {
    return ApplicationTemplateListResponseDto.from(listProgramTemplates());
  }
}
