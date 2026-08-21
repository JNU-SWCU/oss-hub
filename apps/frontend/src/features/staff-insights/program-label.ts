const programLabelSegmenter = new Intl.Segmenter('ko', {
  granularity: 'grapheme',
});
const maximumVisibleGraphemes = 12;

export function formatProgramChartLabel(value: string): string {
  const graphemes = Array.from(
    programLabelSegmenter.segment(value),
    ({ segment }) => segment,
  );
  if (graphemes.length <= maximumVisibleGraphemes) return value;
  return `${graphemes.slice(0, maximumVisibleGraphemes - 1).join('')}…`;
}
