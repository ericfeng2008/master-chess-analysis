type MarkerShapeProps = {
  cx?: number;
  cy?: number;
  fill?: string;
  stroke?: string;
};

export function DiamondShape({ cx = 0, cy = 0, fill = "none", stroke = "currentColor" }: MarkerShapeProps) {
  const s = 6;
  return (
    <polygon
      points={`${cx},${cy - s} ${cx + s},${cy} ${cx},${cy + s} ${cx - s},${cy}`}
      fill={fill}
      stroke={stroke}
      strokeWidth={1.5}
    />
  );
}

export function XMarkShape({ cx = 0, cy = 0, stroke = "currentColor" }: MarkerShapeProps) {
  const s = 5;
  return (
    <g>
      <line
        x1={cx - s}
        y1={cy - s}
        x2={cx + s}
        y2={cy + s}
        stroke={stroke}
        strokeWidth={3.5}
        strokeLinecap="round"
      />
      <line
        x1={cx + s}
        y1={cy - s}
        x2={cx - s}
        y2={cy + s}
        stroke={stroke}
        strokeWidth={3.5}
        strokeLinecap="round"
      />
    </g>
  );
}

export function SquareShape({ cx = 0, cy = 0, fill = "none", stroke = "currentColor" }: MarkerShapeProps) {
  const s = 5;
  return (
    <rect
      x={cx - s}
      y={cy - s}
      width={s * 2}
      height={s * 2}
      fill={fill}
      stroke={stroke}
      strokeWidth={1.5}
    />
  );
}

export function StarShape({ cx = 0, cy = 0, fill = "none", stroke = "currentColor" }: MarkerShapeProps) {
  const outerR = 7;
  const innerR = 3;
  const points: string[] = [];

  for (let i = 0; i < 5; i += 1) {
    const outerAngle = Math.PI / 2 + (2 * Math.PI * i) / 5;
    const innerAngle = outerAngle + Math.PI / 5;

    points.push(`${cx + outerR * Math.cos(outerAngle)},${cy - outerR * Math.sin(outerAngle)}`);
    points.push(`${cx + innerR * Math.cos(innerAngle)},${cy - innerR * Math.sin(innerAngle)}`);
  }

  return <polygon points={points.join(" ")} fill={fill} stroke={stroke} strokeWidth={1} />;
}
