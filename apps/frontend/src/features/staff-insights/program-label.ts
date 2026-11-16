const programLabelSegmenter = new Intl.Segmenter('ko', {
  granularity: 'grapheme',
});
const maximumVisibleGraphemes = 12;

export function formatProgramChartLabel(value: string, rank: number): string {
  const graphemes = Array.from(
    programLabelSegmenter.segment(value),
    ({ segment }) => segment,
  );
  const name =
    graphemes.length <= maximumVisibleGraphemes
      ? value
      : `${graphemes.slice(0, maximumVisibleGraphemes - 1).join('')}…`;
  return `${rank}. ${name}`;
}
