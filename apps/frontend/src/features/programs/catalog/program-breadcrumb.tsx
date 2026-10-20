export interface ProgramBreadcrumbProps {
  readonly programName: string;

  readonly section?: string;
}

export function ProgramBreadcrumb({
  programName,
  section,
}: ProgramBreadcrumbProps) {
  const text = section
    ? `프로그램 › ${programName} › ${section}`
    : `프로그램 › ${programName}`;

  return (
    <p data-slot="program-breadcrumb" className="text-xs text-muted-foreground">
      {text}
    </p>
  );
}
