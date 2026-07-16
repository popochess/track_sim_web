import {
  AdapterTrack,
  StraightTrack as StraightTrackDefinition,
  TrackDefinition
} from "../lib/tomix-tracks";

const gaugeHalf = 4.5;
const sleeperWidth = 18.5;
const labelFontSize = 14;

export type TrackBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function TrackShape({
  track,
  labelRotation = 0
}: {
  track: TrackDefinition;
  labelRotation?: number;
}) {
  if (track.kind === "curve") {
    return <CurveTrack track={track} labelRotation={labelRotation} />;
  }

  if (track.kind === "turnout") {
    return <TurnoutTrack track={track} labelRotation={labelRotation} />;
  }

  return <StraightTrack track={track} labelRotation={labelRotation} />;
}

export function TrackSelectionFrame({
  track,
  onRotatePointerDown
}: {
  track: TrackDefinition;
  onRotatePointerDown?: (event: React.PointerEvent<SVGGElement>) => void;
}) {
  const bounds = getTrackBounds(track);
  const handleX = bounds.x + bounds.width / 2;
  const handleY = bounds.y - 34;
  return (
    <g className="selection-frame">
      <rect
        x={fmt(bounds.x - 12)}
        y={fmt(bounds.y - 12)}
        width={fmt(bounds.width + 24)}
        height={fmt(bounds.height + 24)}
        rx={8}
      />
      <circle cx={fmt(bounds.x)} cy={fmt(bounds.y)} r={5} />
      <circle cx={fmt(bounds.x + bounds.width / 2)} cy={fmt(bounds.y)} r={5} />
      <circle cx={fmt(bounds.x + bounds.width)} cy={fmt(bounds.y)} r={5} />
      <circle cx={fmt(bounds.x)} cy={fmt(bounds.y + bounds.height)} r={5} />
      <circle
        cx={fmt(bounds.x + bounds.width / 2)}
        cy={fmt(bounds.y + bounds.height)}
        r={5}
      />
      <circle
        cx={fmt(bounds.x + bounds.width)}
        cy={fmt(bounds.y + bounds.height)}
        r={5}
      />
      <g
        className="rotate-handle"
        transform={`translate(${fmt(handleX)} ${fmt(handleY)})`}
        onPointerDown={onRotatePointerDown}
      >
        <line x1={0} y1={10} x2={0} y2={26} />
        <circle cx={0} cy={0} r={11} />
        <path d="M -4 -2 A 5 5 0 1 1 3.6 3.5" />
        <path d="M 3.6 3.5 L 3.2 -2.5 L 8 1" />
      </g>
    </g>
  );
}

export function TrackGhost({ track }: { track: TrackDefinition }) {
  const bounds = getTrackBounds(track);
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const scale = Math.min(1.45, 124 / bounds.width, 92 / bounds.height);

  return (
    <g
      className="track-ghost"
      transform={`scale(${fmt(scale)}) translate(${fmt(-centerX)} ${fmt(
        -centerY
      )})`}
    >
      <TrackShape track={track} />
    </g>
  );
}

function StraightTrack({
  track,
  showLabel = true,
  labelRotation = 0
}: {
  track: StraightTrackDefinition | AdapterTrack;
  showLabel?: boolean;
  labelRotation?: number;
}) {
  const length = track.length;
  return (
    <g className="track-shape">
      <rect
        x={fmt(0)}
        y={fmt(-sleeperWidth / 2)}
        width={fmt(length)}
        height={fmt(sleeperWidth)}
        className="track-bed"
      />
      {Array.from({ length: Math.max(3, Math.floor(length / 28)) }).map((_, i) => {
        const x = 8 + i * 28;
        return (
          <line
            key={i}
            x1={fmt(x)}
            x2={fmt(x)}
            y1={fmt(-sleeperWidth / 2)}
            y2={fmt(sleeperWidth / 2)}
            className="sleeper"
          />
        );
      })}
      <line
        x1={fmt(0)}
        x2={fmt(length)}
        y1={fmt(-gaugeHalf)}
        y2={fmt(-gaugeHalf)}
        className="rail"
      />
      <line
        x1={fmt(0)}
        x2={fmt(length)}
        y1={fmt(gaugeHalf)}
        y2={fmt(gaugeHalf)}
        className="rail"
      />
      {showLabel ? (
        <TrackCodeLabel
          code={track.code}
          x={length / 2}
          y={-0.7}
          rotation={0}
          parentRotation={labelRotation}
        />
      ) : null}
      <Connector x={0} y={0} />
      <Connector x={length} y={0} />
    </g>
  );
}

function CurveTrack({
  track,
  labelRotation
}: {
  track: TrackDefinition;
  labelRotation: number;
}) {
  if (track.kind !== "curve") return null;
  if (isCompactC541(track)) {
    return <CompactC541Curve track={track} labelRotation={labelRotation} />;
  }

  const outerRadius = track.radius + sleeperWidth / 2;
  const innerRadius = track.radius - sleeperWidth / 2;
  const outerStart = polar(outerRadius, 0);
  const outerEnd = polar(outerRadius, track.angle);
  const innerStart = polar(innerRadius, 0);
  const innerEnd = polar(innerRadius, track.angle);
  const largeArc = track.angle > 180 ? 1 : 0;
  const railA = arcPath(track.radius - gaugeHalf, 0, track.angle);
  const railB = arcPath(track.radius + gaugeHalf, 0, track.angle);
  const end = polar(track.radius, track.angle);
  const label = polar(track.radius, track.angle / 2);

  return (
    <g className="track-shape">
      <path
        d={`M ${fmt(outerStart.x)} ${fmt(outerStart.y)} A ${fmt(
          outerRadius
        )} ${fmt(outerRadius)} 0 ${largeArc} 1 ${fmt(outerEnd.x)} ${fmt(
          outerEnd.y
        )} L ${fmt(innerEnd.x)} ${fmt(innerEnd.y)} A ${fmt(innerRadius)} ${fmt(
          innerRadius
        )} 0 ${largeArc} 0 ${fmt(innerStart.x)} ${fmt(innerStart.y)} Z`}
        className="curve-bed"
      />
      <path d={railA} className="rail" />
      <path d={railB} className="rail" />
      {Array.from({ length: Math.max(3, Math.floor(track.angle / 7.5)) }).map(
        (_, i, items) => {
          const angle = (track.angle / (items.length - 1 || 1)) * i;
          const p1 = polar(track.radius - sleeperWidth / 2, angle);
          const p2 = polar(track.radius + sleeperWidth / 2, angle);
          return (
            <line
              key={i}
              x1={fmt(p1.x)}
              y1={fmt(p1.y)}
              x2={fmt(p2.x)}
              y2={fmt(p2.y)}
              className="sleeper"
            />
          );
        }
      )}
      <TrackCodeLabel
        code={track.code}
        x={label.x}
        y={label.y}
        rotation={track.angle / 2 + 90}
        parentRotation={labelRotation}
      />
      <Connector x={track.radius} y={0} />
      <Connector x={end.x} y={end.y} />
    </g>
  );
}

function CompactC541Curve({
  track,
  labelRotation
}: {
  track: Extract<TrackDefinition, { kind: "curve" }>;
  labelRotation: number;
}) {
  const railA = compactArcPath(track.radius - gaugeHalf, 0, track.angle);
  const railB = compactArcPath(track.radius + gaugeHalf, 0, track.angle);
  const outer = compactArcPoints(
    track.radius + sleeperWidth / 2,
    0,
    track.angle,
    track.radius
  );
  const inner = compactArcPoints(
    track.radius - sleeperWidth / 2,
    0,
    track.angle,
    track.radius
  );
  const bedPoints = [...outer, ...inner.reverse()];
  const end = compactArcPoint(track.radius, track.angle);
  const label = compactArcPoint(track.radius, track.angle / 2, track.radius);

  return (
    <g className="track-shape">
      <path
        d={`${bedPoints
          .map((point, index) => `${index === 0 ? "M" : "L"} ${fmt(point.x)} ${fmt(point.y)}`)
          .join(" ")} Z`}
        className="curve-bed"
      />
      <path d={railA} className="rail" />
      <path d={railB} className="rail" />
      {Array.from({ length: 3 }).map((_, i) => {
        const angle = (track.angle / 2) * i;
        const p1 = compactArcPoint(
          track.radius - sleeperWidth / 2,
          angle,
          track.radius
        );
        const p2 = compactArcPoint(
          track.radius + sleeperWidth / 2,
          angle,
          track.radius
        );
        return (
          <line
            key={i}
            x1={fmt(p1.x)}
            y1={fmt(p1.y)}
            x2={fmt(p2.x)}
            y2={fmt(p2.y)}
            className="sleeper"
          />
        );
      })}
      <TrackCodeLabel
        code={track.code}
        x={label.x}
        y={label.y}
        rotation={-track.angle / 2}
        parentRotation={labelRotation}
      />
      <Connector x={0} y={0} />
      <Connector x={end.x} y={end.y} />
    </g>
  );
}

function TurnoutTrack({
  track,
  labelRotation
}: {
  track: TrackDefinition;
  labelRotation: number;
}) {
  if (track.kind !== "turnout") return null;
  if (track.id === "N-CPL317/280-45" || track.id === "N-CPR317/280-45") {
    return <TomixCurvedTurnout track={track} labelRotation={labelRotation} />;
  }

  if (track.id === "PL541-15" || track.id === "PR541-15") {
    return <Tomix541Turnout track={track} labelRotation={labelRotation} />;
  }

  const branch = getTurnoutBranch(track);
  const branchLabel = quadraticPoint(branch.start, branch.control, branch.end, 0.56);
  const branchAngle = quadraticTangentAngle(branch.start, branch.control, branch.end, 0.56);
  return (
    <g className="track-shape turnout">
      <StraightTrack
        track={{ ...track, kind: "straight", length: track.length }}
        showLabel={false}
        labelRotation={labelRotation}
      />
      <path
        d={`M ${fmt(branch.start.x)} ${fmt(branch.start.y)} Q ${fmt(
          branch.control.x
        )} ${fmt(branch.control.y)} ${fmt(branch.end.x)} ${fmt(branch.end.y)}`}
        className="turnout-bed"
      />
      <path
        d={`M ${fmt(branch.start.x)} ${fmt(branch.start.y - gaugeHalf)} Q ${fmt(
          branch.control.x
        )} ${fmt(branch.control.y - gaugeHalf)} ${fmt(branch.end.x)} ${fmt(
          branch.end.y - gaugeHalf
        )}`}
        className="rail"
      />
      <path
        d={`M ${fmt(branch.start.x)} ${fmt(branch.start.y + gaugeHalf)} Q ${fmt(
          branch.control.x
        )} ${fmt(branch.control.y + gaugeHalf)} ${fmt(branch.end.x)} ${fmt(
          branch.end.y + gaugeHalf
        )}`}
        className="rail"
      />
      <TrackCodeLabel
        code={track.code}
        x={branchLabel.x}
        y={branchLabel.y}
        rotation={branchAngle}
        parentRotation={labelRotation}
      />
      <Connector x={branch.start.x} y={branch.start.y} />
      <Connector x={branch.end.x} y={branch.end.y} />
    </g>
  );
}

function TomixCurvedTurnout({
  track,
  labelRotation
}: {
  track: Extract<TrackDefinition, { kind: "turnout" }>;
  labelRotation: number;
}) {
  const centerRadius = 317;
  const outerRadius = 317;
  const innerRadius = 280;
  const angle = 45;
  const mirror = track.id === "N-CPR317/280-45" ? -1 : 1;
  const outerRailA = mirroredPath(compactArcPath(outerRadius - gaugeHalf, 0, angle, centerRadius), mirror);
  const outerRailB = mirroredPath(compactArcPath(outerRadius + gaugeHalf, 0, angle, centerRadius), mirror);
  const innerRailA = mirroredPath(compactArcPath(innerRadius - gaugeHalf, 0, angle, centerRadius), mirror);
  const innerRailB = mirroredPath(compactArcPath(innerRadius + gaugeHalf, 0, angle, centerRadius), mirror);
  const outerBed = curvedTrackBedPath(outerRadius, 0, angle, centerRadius, mirror);
  const innerBed = curvedTrackBedPath(innerRadius, 0, angle, centerRadius, mirror);
  const outerEnd = mirrorPoint(compactArcPoint(outerRadius, angle, centerRadius), mirror);
  const innerStart = mirrorPoint(compactArcPoint(innerRadius, 0, centerRadius), mirror);
  const innerEnd = mirrorPoint(compactArcPoint(innerRadius, angle, centerRadius), mirror);
  const outerLabel = mirrorPoint(compactArcPoint(outerRadius, angle / 2, centerRadius), mirror);
  const innerLabel = mirrorPoint(compactArcPoint(innerRadius, angle / 2, centerRadius), mirror);

  return (
    <g className="track-shape turnout curved-turnout">
      <path d={outerBed} className="curve-bed" />
      <path d={innerBed} className="turnout-bed" />
      <path d={outerRailA} className="rail" />
      <path d={outerRailB} className="rail" />
      <path d={innerRailA} className="rail" />
      <path d={innerRailB} className="rail" />
      {Array.from({ length: 6 }).map((_, i) => {
        const sleeperAngle = (angle / 5) * i;
        const outerA = mirrorPoint(
          compactArcPoint(outerRadius - sleeperWidth / 2, sleeperAngle, centerRadius),
          mirror
        );
        const outerB = mirrorPoint(
          compactArcPoint(outerRadius + sleeperWidth / 2, sleeperAngle, centerRadius),
          mirror
        );
        const innerA = mirrorPoint(
          compactArcPoint(innerRadius - sleeperWidth / 2, sleeperAngle, centerRadius),
          mirror
        );
        const innerB = mirrorPoint(
          compactArcPoint(innerRadius + sleeperWidth / 2, sleeperAngle, centerRadius),
          mirror
        );
        return (
          <g key={i}>
            <line
              x1={fmt(outerA.x)}
              y1={fmt(outerA.y)}
              x2={fmt(outerB.x)}
              y2={fmt(outerB.y)}
              className="sleeper"
            />
            <line
              x1={fmt(innerA.x)}
              y1={fmt(innerA.y)}
              x2={fmt(innerB.x)}
              y2={fmt(innerB.y)}
              className="sleeper"
            />
          </g>
        );
      })}
      <TrackCodeLabel
        code={track.code}
        x={outerLabel.x}
        y={outerLabel.y}
        rotation={(-angle / 2) * mirror}
        parentRotation={labelRotation}
      />
      <TrackCodeLabel
        code={track.code}
        x={innerLabel.x}
        y={innerLabel.y}
        rotation={(-angle / 2) * mirror}
        parentRotation={labelRotation}
      />
      <Connector x={0} y={0} />
      <Connector x={fmt(innerStart.x)} y={fmt(innerStart.y)} />
      <Connector x={fmt(outerEnd.x)} y={fmt(outerEnd.y)} />
      <Connector x={fmt(innerEnd.x)} y={fmt(innerEnd.y)} />
    </g>
  );
}

function Tomix541Turnout({
  track,
  labelRotation
}: {
  track: Extract<TrackDefinition, { kind: "turnout" }>;
  labelRotation: number;
}) {
  const radius = 541;
  const angle = 15;
  const isRight = track.id === "PR541-15";
  const transformBranch = (points: Array<{ x: number; y: number }>) => {
    return isRight
      ? points.map((point) => ({ x: point.x, y: -point.y }))
      : points;
  };
  const railAPoints = transformBranch(
    compactArcPoints(radius - gaugeHalf, 0, angle, radius)
  );
  const railBPoints = transformBranch(
    compactArcPoints(radius + gaugeHalf, 0, angle, radius)
  );
  const bedOuter = transformBranch(
    compactArcPoints(radius + sleeperWidth / 2, 0, angle, radius)
  );
  const bedInner = transformBranch(
    compactArcPoints(radius - sleeperWidth / 2, 0, angle, radius)
  );
  const branchBed = pointsPath([...bedOuter, ...bedInner.reverse()]) + " Z";
  const railA = pointsPath(railAPoints);
  const railB = pointsPath(railBPoints);
  const branchCenter = transformBranch(
    compactArcPoints(radius, 0, angle, radius)
  );
  const branchStart = branchCenter[0];
  const branchEnd = branchCenter[branchCenter.length - 1];
  const branchLabel = branchCenter[Math.floor(branchCenter.length / 2)];

  return (
    <g className="track-shape turnout">
      <StraightTrack
        track={{ ...track, kind: "straight", length: track.length }}
        showLabel={false}
        labelRotation={labelRotation}
      />
      <path d={branchBed} className="curve-bed" />
      <path d={railA} className="rail" />
      <path d={railB} className="rail" />
      <TrackCodeLabel
        code={track.code}
        x={branchLabel.x}
        y={branchLabel.y}
        rotation={0}
        parentRotation={labelRotation}
      />
      <Connector x={branchStart.x} y={branchStart.y} />
      <Connector x={branchEnd.x} y={branchEnd.y} />
    </g>
  );
}

function TrackCodeLabel({
  code,
  x,
  y,
  rotation,
  parentRotation = 0
}: {
  code: string;
  x: number;
  y: number;
  rotation: number;
  parentRotation?: number;
}) {
  const displayRotation = getUprightLabelRotation(rotation, parentRotation);
  return (
    <text
      className="track-code-label"
      x={fmt(x)}
      y={fmt(y + labelFontSize * 0.32)}
      transform={`rotate(${fmt(displayRotation)} ${fmt(x)} ${fmt(y)})`}
    >
      {code}
    </text>
  );
}

function getUprightLabelRotation(rotation: number, parentRotation: number) {
  const screenRotation = normalizeSignedAngle(rotation + parentRotation);
  return Math.abs(screenRotation) > 90 ? rotation + 180 : rotation;
}

function normalizeSignedAngle(angle: number) {
  const normalized = ((angle + 180) % 360 + 360) % 360 - 180;
  return normalized === -180 ? 180 : normalized;
}

function Connector({ x, y }: { x: number; y: number }) {
  return <circle cx={fmt(x)} cy={fmt(y)} r={fmt(4.2)} className="connector" />;
}

function arcPath(radius: number, startAngle: number, endAngle: number) {
  const start = polar(radius, startAngle);
  const end = polar(radius, endAngle);
  const largeArc = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
  return `M ${fmt(start.x)} ${fmt(start.y)} A ${fmt(radius)} ${fmt(
    radius
  )} 0 ${largeArc} 1 ${fmt(end.x)} ${fmt(end.y)}`;
}

function arcPathFromCenter(
  radius: number,
  startAngle: number,
  endAngle: number,
  center: { x: number; y: number }
) {
  const steps = Math.max(8, Math.ceil(Math.abs(endAngle - startAngle) / 2));
  const points = Array.from({ length: steps + 1 }, (_, index) => {
    const angle = startAngle + ((endAngle - startAngle) * index) / steps;
    return {
      x: center.x + Math.sin((angle * Math.PI) / 180) * radius,
      y: center.y + Math.cos((angle * Math.PI) / 180) * radius
    };
  });

  return points
    .map((point, index) =>
      `${index === 0 ? "M" : "L"} ${fmt(point.x)} ${fmt(point.y)}`
    )
    .join(" ");
}

function pointsPath(points: Array<{ x: number; y: number }>) {
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${fmt(point.x)} ${fmt(point.y)}`
    )
    .join(" ");
}

function curvedTrackBedPath(
  radius: number,
  startAngle: number,
  endAngle: number,
  centerRadius: number,
  mirror: number
) {
  const outer = compactArcPoints(
    radius + sleeperWidth / 2,
    startAngle,
    endAngle,
    centerRadius
  ).map((point) => mirrorPoint(point, mirror));
  const inner = compactArcPoints(
    radius - sleeperWidth / 2,
    startAngle,
    endAngle,
    centerRadius
  )
    .reverse()
    .map((point) => mirrorPoint(point, mirror));
  return [...outer, ...inner]
    .map((point, index) =>
      `${index === 0 ? "M" : "L"} ${fmt(point.x)} ${fmt(point.y)}`
    )
    .join(" ") + " Z";
}

function mirroredPath(path: string, mirror: number) {
  if (mirror === 1) return path;
  return path.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x, y) => {
    return `${x} ${fmt(Number(y) * mirror)}`;
  });
}

function mirrorPoint(point: { x: number; y: number }, mirror: number) {
  return {
    x: point.x,
    y: point.y * mirror
  };
}

function polar(radius: number, angle: number) {
  const radians = (angle * Math.PI) / 180;
  return {
    x: Math.cos(radians) * radius,
    y: Math.sin(radians) * radius
  };
}

function pointOnArcFromCenter(
  radius: number,
  angle: number,
  center: { x: number; y: number }
) {
  return {
    x: center.x + Math.sin((angle * Math.PI) / 180) * radius,
    y: center.y + Math.cos((angle * Math.PI) / 180) * radius
  };
}

function quadraticPoint(
  start: { x: number; y: number },
  control: { x: number; y: number },
  end: { x: number; y: number },
  t: number
) {
  const oneMinusT = 1 - t;
  return {
    x: oneMinusT * oneMinusT * start.x + 2 * oneMinusT * t * control.x + t * t * end.x,
    y: oneMinusT * oneMinusT * start.y + 2 * oneMinusT * t * control.y + t * t * end.y
  };
}

function quadraticTangentAngle(
  start: { x: number; y: number },
  control: { x: number; y: number },
  end: { x: number; y: number },
  t: number
) {
  const dx = 2 * (1 - t) * (control.x - start.x) + 2 * t * (end.x - control.x);
  const dy = 2 * (1 - t) * (control.y - start.y) + 2 * t * (end.y - control.y);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

export function getTrackBounds(track: TrackDefinition): TrackBounds {
  if (track.kind === "curve") {
    if (isCompactC541(track)) {
      const points = [
        ...compactArcPoints(
          track.radius - sleeperWidth / 2,
          0,
          track.angle,
          track.radius
        ),
        ...compactArcPoints(
          track.radius + sleeperWidth / 2,
          0,
          track.angle,
          track.radius
        )
      ];
      return boundsFromPoints(points);
    }

    const points = [];
    for (let angle = 0; angle <= track.angle; angle += 5) {
      points.push(polar(track.radius - sleeperWidth / 2, angle));
      points.push(polar(track.radius + sleeperWidth / 2, angle));
    }
    points.push(polar(track.radius - sleeperWidth / 2, track.angle));
    points.push(polar(track.radius + sleeperWidth / 2, track.angle));
    return boundsFromPoints(points);
  }

  if (track.kind === "turnout") {
    if (track.id === "PL541-15" || track.id === "PR541-15") {
      const mirror = track.id === "PR541-15" ? -1 : 1;
      const points = [
        { x: 0, y: -sleeperWidth / 2 },
        { x: track.length, y: -sleeperWidth / 2 },
        { x: 0, y: sleeperWidth / 2 },
        { x: track.length, y: sleeperWidth / 2 },
        ...compactArcPoints(541 - sleeperWidth / 2, 0, 15, 541),
        ...compactArcPoints(541 + sleeperWidth / 2, 0, 15, 541)
      ].map((point) =>
        "x" in point && "y" in point ? mirrorPoint(point, mirror) : point
      );
      return boundsFromPoints(points);
    }

    if (track.id === "N-CPL317/280-45" || track.id === "N-CPR317/280-45") {
      const mirror = track.id === "N-CPR317/280-45" ? -1 : 1;
      const points = [
        ...compactArcPoints(317 - sleeperWidth / 2, 0, 45, 317),
        ...compactArcPoints(317 + sleeperWidth / 2, 0, 45, 317),
        ...compactArcPoints(280 - sleeperWidth / 2, 0, 45, 317),
        ...compactArcPoints(280 + sleeperWidth / 2, 0, 45, 317)
      ].map((point) => mirrorPoint(point, mirror));
      return boundsFromPoints(points);
    }

    const branch = getTurnoutBranch(track);
    return boundsFromPoints([
      { x: 0, y: -sleeperWidth / 2 },
      { x: track.length, y: sleeperWidth / 2 },
      { x: branch.start.x, y: branch.start.y - sleeperWidth },
      { x: branch.start.x, y: branch.start.y + sleeperWidth },
      { x: branch.end.x, y: branch.end.y - sleeperWidth },
      { x: branch.end.x, y: branch.end.y + sleeperWidth }
    ]);
  }

  return {
    x: 0,
    y: -sleeperWidth / 2,
    width: track.length,
    height: sleeperWidth
  };
}

function isCompactC541(track: TrackDefinition) {
  return track.kind === "curve" && (track.id === "C541-15" || track.id === "C541PC-15");
}

function compactArcPath(
  radius: number,
  startAngle: number,
  endAngle: number,
  centerRadius = 541
) {
  return compactArcPoints(radius, startAngle, endAngle, centerRadius)
    .map((point, index) =>
      `${index === 0 ? "M" : "L"} ${fmt(point.x)} ${fmt(point.y)}`
    )
    .join(" ");
}

function compactArcPoints(
  radius: number,
  startAngle: number,
  endAngle: number,
  centerRadius = radius
) {
  const steps = Math.max(8, Math.ceil(Math.abs(endAngle - startAngle) / 2));
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = startAngle + ((endAngle - startAngle) * index) / steps;
    return compactArcPoint(radius, angle, centerRadius);
  });
}

function compactArcPoint(radius: number, angle: number, centerRadius = radius) {
  const radians = (angle * Math.PI) / 180;
  return {
    x: Math.sin(radians) * radius,
    y: -centerRadius + Math.cos(radians) * radius
  };
}

function getTurnoutBranch(track: Extract<TrackDefinition, { kind: "turnout" }>) {
  if (track.branchFrom === "end") {
    const branchStart = {
      x: track.length - Math.cos((Math.abs(track.branchAngle) * Math.PI) / 180) * track.branchLength,
      y: Math.sin((track.branchAngle * Math.PI) / 180) * track.branchLength
    };
    return {
      start: branchStart,
      control: {
        x: track.length * 0.58,
        y: branchStart.y * 0.75
      },
      end: { x: track.length, y: 0 }
    };
  }

  const branchEnd = polar(track.branchLength, track.branchAngle);
  return {
    start: { x: 0, y: 0 },
    control: {
      x: track.length * 0.42,
      y: branchEnd.y * 0.25
    },
    end: branchEnd
  };
}

function boundsFromPoints(points: Array<{ x: number; y: number }>) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function fmt(value: number) {
  return Number(value.toFixed(3));
}
