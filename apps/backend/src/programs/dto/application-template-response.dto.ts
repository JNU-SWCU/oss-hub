import type {
  ProgramTemplate,
  FieldDef,
  ProgramParticipation,
} from '../team-application.service';

export class ApplicationFieldResponseDto {
  declare readonly key: FieldDef['key'];
  declare readonly type: FieldDef['type'];
  declare readonly label: string;
  declare readonly required: boolean;

  static from(field: FieldDef): ApplicationFieldResponseDto {
    return {
      key: field.key,
      type: field.type,
      label: field.label,
      required: field.required,
    };
  }
}

export class ApplicationTemplateResponseDto {
  declare readonly key: string;
  declare readonly version: number;
  declare readonly name: string;
  declare readonly participation: ProgramParticipation;
  declare readonly teamSize: {
    readonly defaultMin: number;
    readonly defaultMax: number;
    readonly editable: boolean;
  };
  declare readonly fields: ApplicationFieldResponseDto[];

  static from(template: ProgramTemplate): ApplicationTemplateResponseDto {
    return {
      key: template.key,
      version: template.version,
      name: template.name,
      participation: template.participation,
      teamSize: template.teamSize,
      fields: template.fields.map((field) =>
        ApplicationFieldResponseDto.from(field),
      ),
    };
  }
}

export class ApplicationTemplateListResponseDto {
  declare readonly items: ApplicationTemplateResponseDto[];

  static from(
    templates: readonly ProgramTemplate[],
  ): ApplicationTemplateListResponseDto {
    return {
      items: templates.map((template) =>
        ApplicationTemplateResponseDto.from(template),
      ),
    };
  }
}
