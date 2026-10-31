export const asiaSeoulYear = (at: Date): number =>
  new Date(at.getTime() + 9 * 60 * 60 * 1000).getUTCFullYear();
