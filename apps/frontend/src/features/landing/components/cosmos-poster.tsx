import { projectPoint } from '../cosmos/cosmos-camera';
import {
  applyCosmosPrograms,
  type CosmosProgram,
} from '../cosmos/cosmos-graph';
import { cosmosNodeRadius, INITIAL_ORBIT } from '../cosmos/cosmos-initial';
import { settledCosmosGraph } from '../cosmos/cosmos-layout';
import {
  COSMOS_LABEL_GAP,
  cosmosLabelText,
  cosmosLabelWidth,
} from '../cosmos/cosmos-label';
import {
  LABEL_MIN_ALPHA,
  LABEL_PLATE_ALPHA,
  NIGHT_THEME,
  rgba,
} from '../cosmos/cosmos-theme';
import styles from './cosmos-poster.module.css';

export function CosmosPoster({
  programs,
}: {
  readonly programs: readonly CosmosProgram[];
}) {
  const graph = settledCosmosGraph();
  applyCosmosPrograms(graph, programs);
  const points = graph.nodes.map((node) => {
    const point = { ok: false, x: 0, y: 0, scale: 0, depth: 0 };
    projectPoint(
      node.x,
      node.y,
      node.z,
      INITIAL_ORBIT,
      { cx: 0, cy: 0, radius: 1 },
      point,
    );
    return point;
  });
  const colors = {
    p: NIGHT_THEME.program,
    s: NIGHT_THEME.student,
    r: NIGHT_THEME.repository,
  };
  return (
    <div data-cosmos-poster="" aria-hidden="true" className={styles.poster}>
      <svg className={styles.edges} viewBox="-1 -1 2 2" overflow="visible">
        {graph.edges.map((edge, index) => {
          const a = points[edge.a];
          const b = points[edge.b];
          if (!a?.ok || !b?.ok) return null;
          const alpha = 0.1 + (0.2 * (a.depth + b.depth)) / 2;
          return (
            <line
              key={index}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={rgba(NIGHT_THEME.edge, alpha)}
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
      <svg className={styles.nodes}>
        {graph.nodes.map((node, index) => {
          const point = points[index];
          if (!point?.ok) return null;
          const radius = cosmosNodeRadius(node) * point.scale;
          const text = cosmosLabelText(node.name);
          const size = Math.round(10 + point.depth * 3);
          const width = cosmosLabelWidth(text, size);
          const offset = radius + 6;
          const labelAlpha =
            LABEL_MIN_ALPHA + (0.95 - LABEL_MIN_ALPHA) * point.depth;
          const gap = Math.min(
            ...points
              .slice(0, graph.programCount)
              .filter(
                (candidate, other) =>
                  graph.nodes[other]?.name && candidate.depth > point.depth,
              )
              .map((candidate) => Math.abs(candidate.y - point.y)),
          );
          const alpha =
            Math.round(
              ((node.kind === 'p' ? 0.5 : 0.32) +
                (node.kind === 'p' ? 0.5 : 0.68) * point.depth) *
                10,
            ) / 10;
          return (
            <g
              key={index}
              style={{
                transform: `translate(calc(50cqw + var(--cosmos-radius) * ${point.x}), calc(48cqh + var(--cosmos-radius) * ${point.y}))`,
              }}
            >
              <circle r={radius} fill={rgba(colors[node.kind], alpha)} />
              {node.name ? (
                <g
                  style={{
                    transform: `translateX(clamp(${-width - offset * 2}px, calc((var(--cosmos-radius) * ${point.x} + ${offset + width + 12}px - 50cqw) * -100000), 0px))`,
                  }}
                >
                  <clipPath id={`cosmos-label-${index}`}>
                    <rect
                      x="-4"
                      y="-12"
                      width={width + 8}
                      height="28"
                      style={{
                        height: Number.isFinite(gap)
                          ? `clamp(0px, calc((var(--cosmos-radius) * ${gap} - ${COSMOS_LABEL_GAP}px) * 100000), 28px)`
                          : '28px',
                      }}
                    />
                  </clipPath>
                  <g
                    transform={`translate(${offset} 0)`}
                    clipPath={`url(#cosmos-label-${index})`}
                  >
                    <rect
                      x="-4"
                      y={-size * 0.62 - 2}
                      width={width + 8}
                      height={size * 1.12 + 4}
                      rx="4"
                      fill={rgba(
                        NIGHT_THEME.void,
                        labelAlpha * LABEL_PLATE_ALPHA,
                      )}
                    />
                    <text
                      dominantBaseline="central"
                      fontSize={size}
                      fontWeight="500"
                      fill={rgba(NIGHT_THEME.label, labelAlpha)}
                    >
                      {text}
                    </text>
                  </g>
                </g>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
