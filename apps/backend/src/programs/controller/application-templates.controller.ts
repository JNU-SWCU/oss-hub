import { Controller, Get } from '@nestjs/common';
import { Public } from '../../auth/auth-route-metadata';
import { ApplicationTemplateListResponseDto } from '../dto/application-template-response.dto';
import { listProgramTemplates } from '../program-template.registry';

@Controller('programs/application-templates')
@Public()
export class ApplicationTemplatesController {
  @Get()
  list(): ApplicationTemplateListResponseDto {
    return ApplicationTemplateListResponseDto.from(listProgramTemplates());
  }
}
