import { TrackDefinition } from "./tomix-tracks";

export type SimulationPlacedTrack = {
  id: string;
  trackId: string;
  x: number;
  y: number;
  rotation: number;
  turnoutRoute?: TurnoutRoute;
};

export type SimulationPoint = { x: number; y: number };
export type TurnoutRoute = "main" | "branch";

export type TrainRoute = {
  points: SimulationPoint[];
  cumulative: number[];
  totalLength: number;
  segmentCount: number;
  closed: boolean;
  debug?: {
    anchor: string;
    traversal: string[];
  };
};

export type TrainRouteAnchor = {
  point: SimulationPoint;
  heading: SimulationPoint;
};

export type TrainPose = SimulationPoint & {
  angle: number;
};

export type TrackPolyline = {
  id: string;
  points: SimulationPoint[];
};

export type TurnoutIndicator = {
  id: string;
  code: string;
  route: TurnoutRoute;
  mainPoints: SimulationPoint[];
  branchPoints: SimulationPoint[];
};

type RouteSegment = {
  debugLabel: string;
  points: SimulationPoint[];
  length: number;
  startNode: number;
  endNode: number;
  allowsForward: boolean;
  allowsBackward: boolean;
  selectedBranch: boolean;
};

type RoutePolyline = {
  debugLabel: string;
  points: SimulationPoint[];
  allowsForward: boolean;
  allowsBackward: boolean;
  selectedBranch: boolean;
};

type ClosedLoop = {
  points: SimulationPoint[];
  segmentCount: number;
  length: number;
};

// Keep this below the 18.4 mm turnout branch offset, so two adjacent turnout
// exits never collapse into one node while hand-placed joints still connect.
const connectionTolerance = 16;

export const TRAIN_CAR_LENGTH_MM = 125;
export const TRAIN_CAR_CENTER_SPACING_MM = 132;

export function buildTrainRoute(
  placed: SimulationPlacedTrack[],
  trackMap: Map<string, TrackDefinition>,
  anchor?: TrainRouteAnchor | null
): TrainRoute {
  const polylines = buildRouteTrackPolylines(placed, trackMap);
  const segments: RouteSegment[] = [];

  // Cluster every endpoint before creating route segments. This makes a
  // turnout-to-turnout junction one physical graph node even when several
  // endpoint coordinates form a tolerance chain.
  const endpoints = polylines.flatMap((polyline) => [
    polyline.points[0],
    polyline.points[polyline.points.length - 1]
  ]);
  const parents = endpoints.map((_, index) => index);
  const findRoot = (index: number): number => {
    if (parents[index] === index) return index;
    parents[index] = findRoot(parents[index]);
    return parents[index];
  };
  const joinRoots = (a: number, b: number) => {
    const rootA = findRoot(a);
    const rootB = findRoot(b);
    if (rootA !== rootB) parents[rootB] = rootA;
  };

  for (let first = 0; first < endpoints.length; first += 1) {
    for (let second = first + 1; second < endpoints.length; second += 1) {
      if (distanceBetween(endpoints[first], endpoints[second]) <= connectionTolerance) {
        joinRoots(first, second);
      }
    }
  }

  const nodeByRoot = new Map<number, number>();
  const getNode = (endpointIndex: number) => {
    const root = findRoot(endpointIndex);
    const existing = nodeByRoot.get(root);
    if (existing !== undefined) return existing;
    const node = nodeByRoot.size;
    nodeByRoot.set(root, node);
    return node;
  };

  for (const [index, polyline] of polylines.entries()) {
    const points = polyline.points;
    const startNode = getNode(index * 2);
    const endNode = getNode(index * 2 + 1);
    segments.push({
      debugLabel: polyline.debugLabel,
      points,
      length: polylineLength(points),
      startNode,
      endNode,
      allowsForward: polyline.allowsForward,
      allowsBackward: polyline.allowsBackward,
      selectedBranch: polyline.selectedBranch
    });
  }

  if (segments.length === 0) return emptyRoute();

  const adjacency = new Map<number, number[]>();
  segments.forEach((segment, index) => {
    addAdjacent(adjacency, segment.startNode, index);
    addAdjacent(adjacency, segment.endNode, index);
  });

  const anchoredRoute = anchor
    ? buildAnchoredTrainRoute(segments, adjacency, anchor)
    : null;
  if (anchoredRoute) return anchoredRoute;

  // A layout can contain sidings and turnout branches attached to an otherwise
  // closed main line. Prefer that continuous loop for train operation instead
  // of walking into a siding endpoint and treating it as the end of the route.
  const closedLoop = findLongestClosedLoop(segments, adjacency);
  if (closedLoop) {
    const cumulative = buildCumulativeLengths(closedLoop.points);
    return {
      points: closedLoop.points,
      cumulative,
      totalLength: cumulative[cumulative.length - 1] ?? 0,
      segmentCount: closedLoop.segmentCount,
      closed: true
    };
  }

  const component = getLongestComponent(segments, adjacency);
  if (component.length === 0) return emptyRoute();

  const componentSet = new Set(component);
  const degree = (node: number) =>
    (adjacency.get(node) ?? []).filter((index) => componentSet.has(index)).length;
  const firstSegment = segments[component[0]];
  const endpoint = component
    .flatMap((index) => [segments[index].startNode, segments[index].endNode])
    .find(
      (node) =>
        degree(node) === 1 &&
        (adjacency.get(node) ?? []).some(
          (index) => componentSet.has(index) && canTraverseSegment(segments[index], node)
        )
    );
  const startNode = endpoint ?? (
    firstSegment.allowsForward ? firstSegment.startNode : firstSegment.endNode
  );
  const orderedPoints: SimulationPoint[] = [];
  const used = new Set<number>();
  let currentNode = startNode;

  while (used.size < component.length) {
    const candidates = (adjacency.get(currentNode) ?? []).filter(
      (index) =>
        componentSet.has(index) &&
        !used.has(index) &&
        canTraverseSegment(segments[index], currentNode)
    );
    if (candidates.length === 0) break;

    const segmentIndex = chooseNextSegment(
      candidates,
      segments,
      currentNode,
      orderedPoints
    );
    const segment = segments[segmentIndex];
    const forward = segment.startNode === currentNode;
    const nextPoints = forward ? segment.points : [...segment.points].reverse();
    appendPoints(orderedPoints, nextPoints);
    used.add(segmentIndex);
    currentNode = forward ? segment.endNode : segment.startNode;
  }

  const closed = used.size > 1 && currentNode === startNode;
  if (closed && orderedPoints.length > 1) {
    const lastIndex = orderedPoints.length - 1;
    const join = midpoint(orderedPoints[lastIndex], orderedPoints[0]);
    orderedPoints[0] = join;
    orderedPoints[lastIndex] = join;
  }
  const cumulative = buildCumulativeLengths(orderedPoints);
  return {
    points: orderedPoints,
    cumulative,
    totalLength: cumulative[cumulative.length - 1] ?? 0,
    segmentCount: used.size,
    closed
  };
}

export function buildTrackPolylines(
  placed: SimulationPlacedTrack[],
  trackMap: Map<string, TrackDefinition>
): TrackPolyline[] {
  return placed.flatMap((item) => {
    const track = trackMap.get(item.trackId);
    if (!track) return [];
    const pivot = getTrackPivot(track);
    return getTrackCenterlines(track).map((localPoints, index) => ({
      id: `${item.id}:${index}`,
      points: localPoints.map((point) =>
        transformPoint(point, pivot, item.x, item.y, item.rotation)
      )
    }));
  });
}

export function buildTurnoutIndicators(
  placed: SimulationPlacedTrack[],
  trackMap: Map<string, TrackDefinition>
): TurnoutIndicator[] {
  return placed.flatMap((item) => {
    const track = trackMap.get(item.trackId);
    if (!track || track.kind !== "turnout") return [];
    const pivot = getTrackPivot(track);
    const [main, branch] = getTurnoutCenterlines(track);
    const transform = (points: SimulationPoint[]) =>
      points.map((point) => transformPoint(point, pivot, item.x, item.y, item.rotation));

    return [{
      id: item.id,
      code: track.code,
      route: item.turnoutRoute ?? "main",
      mainPoints: transform(main),
      branchPoints: transform(branch)
    }];
  });
}

function buildRouteTrackPolylines(
  placed: SimulationPlacedTrack[],
  trackMap: Map<string, TrackDefinition>
): RoutePolyline[] {
  return placed.flatMap((item) => {
    const track = trackMap.get(item.trackId);
    if (!track) return [];
    const pivot = getTrackPivot(track);
    const transform = (points: SimulationPoint[]) =>
      points.map((point) =>
        transformPoint(point, pivot, item.x, item.y, item.rotation)
      );

    if (track.kind !== "turnout") {
      return [{
        debugLabel: `${track.code} (${item.id.slice(-5)})`,
        points: transform(getTrackCenterline(track)),
        allowsForward: true,
        allowsBackward: true,
        selectedBranch: false
      }];
    }

    const selectedRoute = item.turnoutRoute ?? "main";
    const commonAtEnd = track.branchFrom === "end";
    return getTurnoutCenterlines(track).map((points, index) => {
      const route = index === 0 ? "main" : "branch";
      const selected = route === selectedRoute;
      return {
        debugLabel: `${track.code} (${item.id.slice(-5)}) ${route}`,
        points: transform(points),
        // Facing a point only permits the route selected by its controller.
        // Trailing through either outer leg into the common leg is always valid.
        allowsForward: commonAtEnd ? true : selected,
        allowsBackward: commonAtEnd ? selected : true,
        selectedBranch: route === "branch" && selected
      };
    });
  });
}

export function sampleTrainRoute(
  route: TrainRoute,
  distance: number,
  reverse = false
): TrainPose | null {
  if (route.points.length < 2 || route.totalLength <= 0) return null;

  const position = pointAtRouteDistance(route, distance);
  const tangentSample = Math.min(12, route.totalLength / 4);
  const before = pointAtRouteDistance(route, distance - tangentSample);
  const after = pointAtRouteDistance(route, distance + tangentSample);
  const angle = (Math.atan2(after.y - before.y, after.x - before.x) * 180) / Math.PI;

  return {
    ...position,
    angle: reverse ? angle + 180 : angle
  };
}

export function getClosestRouteDistance(route: TrainRoute, point: SimulationPoint) {
  if (route.points.length < 2) return 0;

  let closestDistance = 0;
  let shortestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < route.points.length - 1; index += 1) {
    const start = route.points[index];
    const end = route.points[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) continue;
    const progress = Math.max(
      0,
      Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)
    );
    const candidate = {
      x: start.x + dx * progress,
      y: start.y + dy * progress
    };
    const distance = distanceBetween(point, candidate);
    if (distance < shortestDistance) {
      shortestDistance = distance;
      closestDistance = (route.cumulative[index] ?? 0) + Math.sqrt(lengthSquared) * progress;
    }
  }
  return closestDistance;
}

function pointAtRouteDistance(route: TrainRoute, distance: number): SimulationPoint {
  const target = route.closed
    ? positiveModulo(distance, route.totalLength)
    : Math.max(0, Math.min(route.totalLength, distance));
  let segmentIndex = 0;
  while (
    segmentIndex < route.cumulative.length - 2 &&
    route.cumulative[segmentIndex + 1] < target
  ) {
    segmentIndex += 1;
  }

  const start = route.points[segmentIndex];
  const end = route.points[segmentIndex + 1] ?? start;
  const startDistance = route.cumulative[segmentIndex] ?? 0;
  const segmentLength = distanceBetween(start, end);
  const progress = segmentLength > 0 ? (target - startDistance) / segmentLength : 0;
  return {
    x: start.x + (end.x - start.x) * progress,
    y: start.y + (end.y - start.y) * progress
  };
}

function getTrackCenterline(
  track: TrackDefinition,
  turnoutRoute: TurnoutRoute = "main"
): SimulationPoint[] {
  if (track.kind === "straight" || track.kind === "adapter") {
    return [
      { x: 0, y: 0 },
      { x: track.length, y: 0 }
    ];
  }

  if (track.kind === "curve") {
    const steps = Math.max(8, Math.ceil(track.angle / 3));
    return Array.from({ length: steps + 1 }, (_, index) => {
      const angle = (track.angle * index) / steps;
      if (track.id === "C541-15" || track.id === "C541PC-15") {
        return compactArcPoint(track.radius, angle, track.radius);
      }
      return polar(track.radius, angle);
    });
  }

  const [main, branch] = getTurnoutCenterlines(track);
  return turnoutRoute === "branch" ? branch : main;
}

function getTrackCenterlines(track: TrackDefinition): SimulationPoint[][] {
  if (track.kind !== "turnout") return [getTrackCenterline(track)];

  return getTurnoutCenterlines(track);
}

function getTurnoutCenterlines(
  track: Extract<TrackDefinition, { kind: "turnout" }>
): [SimulationPoint[], SimulationPoint[]] {
  const main = [
    { x: 0, y: 0 },
    { x: track.length, y: 0 }
  ];

  if (track.id === "PL541-15" || track.id === "PR541-15") {
    const branch = Array.from({ length: 9 }, (_, index) => {
      const point = compactArcPoint(541, (15 * index) / 8, 541);
      return {
        x: point.x,
        y: track.id === "PR541-15" ? -point.y : point.y
      };
    });
    return [main, branch];
  }

  if (track.id === "N-CPL317/280-45" || track.id === "N-CPR317/280-45") {
    const mirror = track.id === "N-CPR317/280-45" ? -1 : 1;
    const outer = Array.from({ length: 16 }, (_, index) => {
      const point = compactArcPoint(317, (45 * index) / 15, 317);
      return { x: point.x, y: point.y * mirror };
    });
    const inner = Array.from({ length: 16 }, (_, index) => {
      const point = compactArcPoint(280, (45 * index) / 15, 317);
      return { x: point.x, y: point.y * mirror };
    });
    return [outer, inner];
  }

  const branch = getTurnoutBranchPoints(track);
  return [main, branch];
}

function getTurnoutBranchPoints(track: Extract<TrackDefinition, { kind: "turnout" }>) {
  let start: SimulationPoint;
  let control: SimulationPoint;
  let end: SimulationPoint;
  if (track.branchFrom === "end") {
    start = {
      x: track.length - Math.cos((Math.abs(track.branchAngle) * Math.PI) / 180) * track.branchLength,
      y: Math.sin((track.branchAngle * Math.PI) / 180) * track.branchLength
    };
    control = { x: track.length * 0.58, y: start.y * 0.75 };
    end = { x: track.length, y: 0 };
  } else {
    start = { x: 0, y: 0 };
    end = polar(track.branchLength, track.branchAngle);
    control = { x: track.length * 0.42, y: end.y * 0.25 };
  }

  return Array.from({ length: 13 }, (_, index) => {
    const t = index / 12;
    const inverse = 1 - t;
    return {
      x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
      y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y
    };
  });
}

function getTrackPivot(track: TrackDefinition): SimulationPoint {
  if (track.kind === "curve") {
    const halfAngle = track.angle / 2;
    if (track.id === "C541-15" || track.id === "C541PC-15") {
      return compactArcPoint(track.radius, halfAngle, track.radius);
    }
    return polar(track.radius, halfAngle);
  }

  return { x: track.length / 2, y: 0 };
}

function transformPoint(
  point: SimulationPoint,
  pivot: SimulationPoint,
  x: number,
  y: number,
  rotation: number
): SimulationPoint {
  const radians = (rotation * Math.PI) / 180;
  const localX = point.x - pivot.x;
  const localY = point.y - pivot.y;
  return {
    x: x + localX * Math.cos(radians) - localY * Math.sin(radians),
    y: y + localX * Math.sin(radians) + localY * Math.cos(radians)
  };
}

function findOrCreateNode(nodes: SimulationPoint[], point: SimulationPoint) {
  const index = nodes.findIndex(
    (node) => distanceBetween(node, point) <= connectionTolerance
  );
  if (index >= 0) return index;
  nodes.push(point);
  return nodes.length - 1;
}

function addAdjacent(adjacency: Map<number, number[]>, node: number, segment: number) {
  adjacency.set(node, [...(adjacency.get(node) ?? []), segment]);
}

function getLongestComponent(segments: RouteSegment[], adjacency: Map<number, number[]>) {
  const visited = new Set<number>();
  let longest: number[] = [];
  let longestLength = 0;

  segments.forEach((_, startIndex) => {
    if (visited.has(startIndex)) return;
    const component: number[] = [];
    const queue = [startIndex];
    visited.add(startIndex);
    while (queue.length > 0) {
      const index = queue.shift()!;
      component.push(index);
      const segment = segments[index];
      for (const node of [segment.startNode, segment.endNode]) {
        for (const neighbor of adjacency.get(node) ?? []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
    }
    const length = component.reduce((sum, index) => sum + segments[index].length, 0);
    if (length > longestLength) {
      longest = component;
      longestLength = length;
    }
  });

  return longest;
}

function buildAnchoredTrainRoute(
  segments: RouteSegment[],
  adjacency: Map<number, number[]>,
  anchor: TrainRouteAnchor
): TrainRoute | null {
  const headingLength = Math.hypot(anchor.heading.x, anchor.heading.y);
  if (headingLength === 0) return null;
  const heading = {
    x: anchor.heading.x / headingLength,
    y: anchor.heading.y / headingLength
  };
  let best:
    | {
        index: number;
        forward: boolean;
        pointIndex: number;
        point: SimulationPoint;
        score: number;
        distance: number;
        alignment: number;
      }
    | null = null;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const closest = closestPointOnPolyline(segment.points, anchor.point);
    for (const forward of [true, false]) {
      if (forward ? !segment.allowsForward : !segment.allowsBackward) continue;
      const points = forward ? segment.points : [...segment.points].reverse();
      const directionIndex = forward
        ? Math.min(points.length - 2, closest.index)
        : Math.max(0, points.length - 2 - closest.index);
      const start = points[directionIndex];
      const end = points[directionIndex + 1];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy) || 1;
      const alignment = (dx / length) * heading.x + (dy / length) * heading.y;
      const score = closest.distance * 100 + (1 - alignment) * 25;
      if (!best || score < best.score) {
        best = {
          index,
          forward,
          pointIndex: directionIndex,
          point: closest.point,
          score,
          distance: closest.distance,
          alignment
        };
      }
    }
  }

  if (!best) return null;
  const firstSegment = segments[best.index];
  const firstPoints = best.forward
    ? firstSegment.points
    : [...firstSegment.points].reverse();
  const orderedPoints = [
    best.point,
    ...firstPoints.slice(best.pointIndex + 1)
  ];
  const used = new Set([best.index]);
  let currentNode = best.forward ? firstSegment.endNode : firstSegment.startNode;
  const returnNode = best.forward ? firstSegment.startNode : firstSegment.endNode;
  let closed = false;
  const traversal = [describeSegment(firstSegment, best.forward)];

  // A point network can have several plausible-looking continuations. Search
  // for a directed path back to the other side of the anchored segment before
  // falling back to the visual "straightest" continuation.
  const closingPath = findDirectedPath(
    currentNode,
    returnNode,
    segments,
    adjacency,
    used
  );
  if (closingPath) {
    const traversal = [describeSegment(firstSegment, best.forward)];
    for (const step of closingPath) {
      const segment = segments[step.index];
      appendPoints(
        orderedPoints,
        step.forward ? segment.points : [...segment.points].reverse()
      );
      used.add(step.index);
      traversal.push(describeSegment(segment, step.forward));
    }
    appendPoints(
      orderedPoints,
      [...firstPoints.slice(0, best.pointIndex + 1)].reverse()
    );
    const cumulative = buildCumulativeLengths(orderedPoints);
    return {
      points: orderedPoints,
      cumulative,
      totalLength: cumulative[cumulative.length - 1] ?? 0,
      segmentCount: used.size,
      closed: true,
      debug: {
        anchor: describeAnchorDecision(firstSegment, best),
        traversal
      }
    };
  }

  while (used.size <= segments.length) {
    // The initial segment is split at the placement point. Once the traversal
    // reaches its other endpoint, append the remaining portion back to that
    // point to complete the loop instead of searching into unrelated sidings.
    if (currentNode === returnNode) {
      appendPoints(
        orderedPoints,
        [...firstPoints.slice(0, best.pointIndex + 1)].reverse()
      );
      closed = true;
      break;
    }

    const candidates = (adjacency.get(currentNode) ?? []).filter(
      (index) => !used.has(index) && canTraverseSegment(segments[index], currentNode)
    );
    if (candidates.length === 0) break;
    const segmentIndex = chooseNextSegment(candidates, segments, currentNode, orderedPoints);
    const segment = segments[segmentIndex];
    const forward = segment.startNode === currentNode;
    appendPoints(orderedPoints, forward ? segment.points : [...segment.points].reverse());
    used.add(segmentIndex);
    traversal.push(describeSegment(segment, forward));
    currentNode = forward ? segment.endNode : segment.startNode;
  }

  const cumulative = buildCumulativeLengths(orderedPoints);
  return {
    points: orderedPoints,
    cumulative,
    totalLength: cumulative[cumulative.length - 1] ?? 0,
    segmentCount: used.size,
    closed,
    debug: {
      anchor: describeAnchorDecision(firstSegment, best),
      traversal
    }
  };
}

function describeSegment(segment: RouteSegment, forward: boolean) {
  return `${segment.debugLabel} ${forward ? "forward" : "reverse"}`;
}

function describeAnchorDecision(
  segment: RouteSegment,
  best: {
    forward: boolean;
    distance: number;
    alignment: number;
    score: number;
  }
) {
  return `${describeSegment(segment, best.forward)}; nearest=${best.distance.toFixed(2)}mm; alignment=${best.alignment.toFixed(3)}; score=${best.score.toFixed(2)}`;
}

function closestPointOnPolyline(points: SimulationPoint[], point: SimulationPoint) {
  let closest = { index: 0, point: points[0], distance: Number.POSITIVE_INFINITY };
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) continue;
    const progress = Math.max(
      0,
      Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared)
    );
    const candidate = { x: start.x + dx * progress, y: start.y + dy * progress };
    const distance = distanceBetween(point, candidate);
    if (distance < closest.distance) closest = { index, point: candidate, distance };
  }
  return closest;
}

function findLongestClosedLoop(
  segments: RouteSegment[],
  adjacency: Map<number, number[]>
) {
  let longest: ClosedLoop | null = null;

  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    for (const forward of [true, false]) {
      const segment = segments[segmentIndex];
      if (forward ? !segment.allowsForward : !segment.allowsBackward) continue;
      const loop = traceClosedLoop(segmentIndex, forward, segments, adjacency);
      if (loop && (!longest || loop.length > longest.length)) {
        longest = loop;
      }
    }
  }

  return longest;
}

function getConnectedSegmentIndexes(
  startIndex: number,
  segments: RouteSegment[],
  adjacency: Map<number, number[]>
) {
  const component = new Set<number>([startIndex]);
  const queue = [startIndex];
  while (queue.length > 0) {
    const index = queue.shift()!;
    const segment = segments[index];
    for (const node of [segment.startNode, segment.endNode]) {
      for (const neighbor of adjacency.get(node) ?? []) {
        if (component.has(neighbor)) continue;
        component.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return component;
}

function traceClosedLoop(
  firstSegmentIndex: number,
  firstForward: boolean,
  segments: RouteSegment[],
  adjacency: Map<number, number[]>
) {
  const firstSegment = segments[firstSegmentIndex];
  const startNode = firstForward ? firstSegment.startNode : firstSegment.endNode;
  let currentNode = firstForward ? firstSegment.endNode : firstSegment.startNode;
  const used = new Set([firstSegmentIndex]);
  const orderedPoints = firstForward
    ? [...firstSegment.points]
    : [...firstSegment.points].reverse();

  while (used.size <= segments.length) {
    if (currentNode === startNode && used.size > 1) {
      const lastIndex = orderedPoints.length - 1;
      const join = midpoint(orderedPoints[lastIndex], orderedPoints[0]);
      orderedPoints[0] = join;
      orderedPoints[lastIndex] = join;
      return {
        points: orderedPoints,
        segmentCount: used.size,
        length: polylineLength(orderedPoints)
      };
    }

    const candidates = (adjacency.get(currentNode) ?? []).filter(
      (index) => !used.has(index) && canTraverseSegment(segments[index], currentNode)
    );
    if (candidates.length === 0) return null;

    const segmentIndex = chooseNextSegment(candidates, segments, currentNode, orderedPoints);
    const segment = segments[segmentIndex];
    const forward = segment.startNode === currentNode;
    appendPoints(orderedPoints, forward ? segment.points : [...segment.points].reverse());
    used.add(segmentIndex);
    currentNode = forward ? segment.endNode : segment.startNode;
  }

  return null;
}

function chooseNextSegment(
  candidates: number[],
  segments: RouteSegment[],
  currentNode: number,
  orderedPoints: SimulationPoint[]
) {
  if (candidates.length === 1 || orderedPoints.length < 2) return candidates[0];
  const previous = orderedPoints[orderedPoints.length - 2];
  const current = orderedPoints[orderedPoints.length - 1];
  const incoming = Math.atan2(current.y - previous.y, current.x - previous.x);

  return candidates.reduce((best, candidate) => {
    const bestTurn = segmentTurn(segments[best], currentNode, incoming);
    const candidateTurn = segmentTurn(segments[candidate], currentNode, incoming);
    return candidateTurn < bestTurn ? candidate : best;
  });
}

function canTraverseSegment(segment: RouteSegment, node: number) {
  return segment.startNode === node ? segment.allowsForward : segment.allowsBackward;
}

function findDirectedPath(
  startNode: number,
  targetNode: number,
  segments: RouteSegment[],
  adjacency: Map<number, number[]>,
  excludedSegments: Set<number>
) {
  type PathState = {
    node: number;
    steps: Array<{ index: number; forward: boolean }>;
  };

  const queue: PathState[] = [{ node: startNode, steps: [] }];
  const visitedNodes = new Set([startNode]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const index of adjacency.get(current.node) ?? []) {
      if (excludedSegments.has(index)) continue;
      const segment = segments[index];
      if (!canTraverseSegment(segment, current.node)) continue;
      const forward = segment.startNode === current.node;
      const nextNode = forward ? segment.endNode : segment.startNode;
      const steps = [...current.steps, { index, forward }];
      if (nextNode === targetNode) return steps;
      if (visitedNodes.has(nextNode)) continue;
      visitedNodes.add(nextNode);
      queue.push({ node: nextNode, steps });
    }
  }

  return null;
}

function segmentTurn(segment: RouteSegment, node: number, incoming: number) {
  const points = segment.startNode === node ? segment.points : [...segment.points].reverse();
  const outgoing = Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x);
  return Math.abs(Math.atan2(Math.sin(outgoing - incoming), Math.cos(outgoing - incoming)));
}

function appendPoints(target: SimulationPoint[], source: SimulationPoint[]) {
  if (target.length === 0) {
    target.push(...source);
    return;
  }
  const previous = target[target.length - 1];
  const start = source[0];
  if (distanceBetween(previous, start) <= connectionTolerance) {
    target[target.length - 1] = midpoint(previous, start);
  } else {
    target.push(start);
  }
  target.push(...source.slice(1));
}

function midpoint(a: SimulationPoint, b: SimulationPoint): SimulationPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function buildCumulativeLengths(points: SimulationPoint[]) {
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative[index - 1] + distanceBetween(points[index - 1], points[index]));
  }
  return cumulative;
}

function polylineLength(points: SimulationPoint[]) {
  return buildCumulativeLengths(points).at(-1) ?? 0;
}

function distanceBetween(a: SimulationPoint, b: SimulationPoint) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function polar(radius: number, angle: number): SimulationPoint {
  const radians = (angle * Math.PI) / 180;
  return { x: Math.cos(radians) * radius, y: Math.sin(radians) * radius };
}

function compactArcPoint(radius: number, angle: number, centerRadius: number) {
  const radians = (angle * Math.PI) / 180;
  return {
    x: Math.sin(radians) * radius,
    y: -centerRadius + Math.cos(radians) * radius
  };
}

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

function emptyRoute(): TrainRoute {
  return { points: [], cumulative: [], totalLength: 0, segmentCount: 0, closed: false };
}
