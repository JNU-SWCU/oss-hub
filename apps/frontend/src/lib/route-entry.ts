export interface RouteEntry {
  readonly entry: 'api-link' | 'email-link' | 'external-link';
  readonly source: `apps/${string}`;
}
