export interface RequirementDropZone {
  readonly documentId: string;
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly centerY: number;
}

export function requirementDropZones(
  rows: Iterable<HTMLElement>,
): readonly RequirementDropZone[] {
  return Array.from(rows).map((row) => {
    const rect = row.getBoundingClientRect();
    return {
      documentId: row.dataset.sortableDocumentId ?? '',
      top: rect.top,
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      centerY: rect.top + rect.height / 2,
    };
  });
}

export function requirementDropTarget(
  zones: readonly RequirementDropZone[],
  point: { readonly x: number; readonly y: number },
): string | null {
  const bounds = zones[0];
  const last = zones.at(-1);
  if (
    bounds === undefined ||
    last === undefined ||
    point.x < bounds.left ||
    point.x > bounds.right ||
    point.y < bounds.top ||
    point.y > last.bottom
  ) {
    return null;
  }
  return zones.reduce((nearest, zone) =>
    Math.abs(zone.centerY - point.y) < Math.abs(nearest.centerY - point.y)
      ? zone
      : nearest,
  ).documentId;
}
