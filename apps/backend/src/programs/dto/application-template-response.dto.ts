import type {
  FieldDef,
  ProgramParticipation,
  ProgramTemplate,
} from '../program-template.registry';

export class ApplicationFieldResponseDto {
  readonly key: FieldDef['key'];
  readonly type: FieldDef['type'];
  readonly label: string;
  readonly required: boolean;

  private constructor(field: FieldDef) {
    this.key = field.key;
    this.type = field.type;
    this.label = field.label;
    this.required = field.required;
  }

  static from(field: FieldDef): ApplicationFieldResponseDto {
    return new ApplicationFieldResponseDto(field);
  }
}

export class ApplicationTemplateResponseDto {
  readonly key: string;
  readonly version: number;
  readonly name: string;
  readonly participation: ProgramParticipation;
  readonly fields: readonly ApplicationFieldResponseDto[];

  private constructor(template: ProgramTemplate) {
    this.key = template.key;
    this.version = template.version;
    this.name = template.name;
    this.participation = template.participation;
    this.fields = template.fields.map((field) =>
      ApplicationFieldResponseDto.from(field),
    );
  }

  static from(template: ProgramTemplate): ApplicationTemplateResponseDto {
    return new ApplicationTemplateResponseDto(template);
  }
}

export class ApplicationTemplateListResponseDto {
  readonly items: readonly ApplicationTemplateResponseDto[];

  private constructor(templates: readonly ProgramTemplate[]) {
    this.items = templates.map((template) =>
      ApplicationTemplateResponseDto.from(template),
    );
  }

  static from(
    templates: readonly ProgramTemplate[],
  ): ApplicationTemplateListResponseDto {
    return new ApplicationTemplateListResponseDto(templates);
  }
}
