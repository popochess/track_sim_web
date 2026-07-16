"use client";

import { useCallback, useEffect, useRef } from "react";
import { Maximize2 } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  sampleTrainRoute,
  TRAIN_CAR_CENTER_SPACING_MM,
  TRAIN_CAR_LENGTH_MM,
  TrackPolyline,
  TrainRoute,
  TurnoutIndicator
} from "../lib/train-simulation";

type Layout3DViewProps = {
  layoutWidth: number;
  layoutHeight: number;
  tracks: TrackPolyline[];
  turnouts: TurnoutIndicator[];
  trainRoute: TrainRoute;
  trainDistance: number;
  trainReversed: boolean;
  showTurnoutLabels: boolean;
  showTrain: boolean;
  nightMode: boolean;
};

type SceneTheme = {
  scene: THREE.Scene;
  fog: THREE.Fog;
  hemisphere: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  tableMaterial: THREE.MeshStandardMaterial;
  gridMaterials: THREE.Material[];
};

type TrackTrail = {
  points: THREE.Vector3[];
  closed: boolean;
};

const trainRailHeight = 4.6;
const trackJoinTolerance = 2;

export function Layout3DView({
  layoutWidth,
  layoutHeight,
  tracks,
  turnouts,
  trainRoute,
  trainDistance,
  trainReversed,
  showTurnoutLabels,
  showTrain,
  nightMode
}: Layout3DViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const trackGroupRef = useRef<THREE.Group | null>(null);
  const carGroupsRef = useRef<THREE.Group[]>([]);
  const sceneThemeRef = useRef<SceneTheme | null>(null);
  const frameRef = useRef<number | null>(null);

  const resetCamera = useCallback(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    positionCamera(camera, controls, layoutWidth, layoutHeight);
  }, [layoutWidth, layoutHeight]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xd8d8d8);
    scene.fog = new THREE.Fog(0xd8d8d8, 1500, 4200);

    const camera = new THREE.PerspectiveCamera(42, 1, 1, 8000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.dataset.testid = "layout-3d-canvas";
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.minDistance = 120;
    controls.maxDistance = 4200;
    controls.maxPolarAngle = Math.PI * 0.49;
    positionCamera(camera, controls, layoutWidth, layoutHeight);

    const pressedKeys = new Set<string>();
    const cameraVelocity = new THREE.Vector3();
    const cameraClock = new THREE.Clock();
    let shiftPressed = false;

    const moveCamera = (movement: THREE.Vector3) => {
      camera.position.add(movement);
      controls.target.add(movement);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (event.key === "Shift") {
        shiftPressed = true;
        return;
      }
      const key = normalizeCameraMoveKey(event.key);
      if (!key) return;
      event.preventDefault();
      pressedKeys.add(key);
      if (!event.repeat) {
        moveCamera(getCameraMovement(pressedKeys, camera, controls).multiplyScalar(4));
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") shiftPressed = false;
      const key = normalizeCameraMoveKey(event.key);
      if (key) pressedKeys.delete(key);
    };
    const clearPressedKeys = () => {
      pressedKeys.clear();
      shiftPressed = false;
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", clearPressedKeys);

    const hemisphere = new THREE.HemisphereLight(0xf5f5f5, 0x575757, 2.15);
    scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(0xffffff, 2.6);
    sun.position.set(-500, 1000, -650);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const shadowExtent = Math.max(layoutWidth, layoutHeight) * 0.75;
    sun.shadow.camera.left = -shadowExtent;
    sun.shadow.camera.right = shadowExtent;
    sun.shadow.camera.top = shadowExtent;
    sun.shadow.camera.bottom = -shadowExtent;
    scene.add(sun);

    const tableMaterial = new THREE.MeshStandardMaterial({ color: 0xefefef, roughness: 0.92 });
    const table = new THREE.Mesh(
      new THREE.BoxGeometry(layoutWidth, 18, layoutHeight),
      tableMaterial
    );
    table.position.y = -10;
    table.receiveShadow = true;
    scene.add(table);

    const gridSize = Math.max(layoutWidth, layoutHeight);
    const grid = new THREE.GridHelper(
      gridSize,
      Math.max(12, Math.min(80, Math.round(gridSize / 50))),
      0xb6b6b6,
      0xd1d1d1
    );
    // Keep the planning grid under the trackbed instead of competing with rails.
    grid.position.y = -0.8;
    grid.renderOrder = -1;
    (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach((material) => {
      material.transparent = true;
      material.opacity = 0.18;
      material.depthWrite = false;
    });
    scene.add(grid);

    sceneThemeRef.current = {
      scene,
      fog: scene.fog as THREE.Fog,
      hemisphere,
      sun,
      tableMaterial,
      gridMaterials: Array.isArray(grid.material) ? grid.material : [grid.material]
    };

    const tracksGroup = new THREE.Group();
    const trainsGroup = new THREE.Group();
    scene.add(tracksGroup, trainsGroup);
    const cars = [createTrainCar(true), createTrainCar(false)];
    cars.forEach((car) => trainsGroup.add(car));

    sceneRef.current = scene;
    rendererRef.current = renderer;
    cameraRef.current = camera;
    controlsRef.current = controls;
    trackGroupRef.current = tracksGroup;
    carGroupsRef.current = cars;

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const render = () => {
      const delta = Math.min(cameraClock.getDelta(), 0.05);
      const input = getCameraMovement(pressedKeys, camera, controls);
      const targetVelocity = input.multiplyScalar(shiftPressed ? 144 : 72);
      const blend = 1 - Math.exp(-12 * delta);
      cameraVelocity.lerp(targetVelocity, blend);
      if (targetVelocity.lengthSq() === 0 && cameraVelocity.lengthSq() < 0.01) {
        cameraVelocity.set(0, 0, 0);
      }
      moveCamera(cameraVelocity.clone().multiplyScalar(delta));
      controls.update();
      renderer.render(scene, camera);
      frameRef.current = requestAnimationFrame(render);
    };
    frameRef.current = requestAnimationFrame(render);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", clearPressedKeys);
      observer.disconnect();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      controls.dispose();
      scene.traverse(disposeObject);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      sceneRef.current = null;
      rendererRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      trackGroupRef.current = null;
      carGroupsRef.current = [];
      sceneThemeRef.current = null;
    };
  }, [layoutWidth, layoutHeight]);

  useEffect(() => {
    const theme = sceneThemeRef.current;
    if (!theme) return;

    theme.scene.background = new THREE.Color(nightMode ? 0x101214 : 0xd8d8d8);
    theme.fog.color.set(nightMode ? 0x101214 : 0xd8d8d8);
    theme.hemisphere.color.set(nightMode ? 0x233042 : 0xf5f5f5);
    theme.hemisphere.groundColor.set(nightMode ? 0x050607 : 0x575757);
    theme.hemisphere.intensity = nightMode ? 0.48 : 2.15;
    theme.sun.color.set(nightMode ? 0x9fb6d6 : 0xffffff);
    theme.sun.intensity = nightMode ? 0.52 : 2.6;
    theme.tableMaterial.color.set(nightMode ? 0x25272a : 0xefefef);
    theme.gridMaterials.forEach((material, index) => {
      const gridMaterial = material as THREE.LineBasicMaterial;
      gridMaterial.color.set(nightMode ? (index === 0 ? 0x5f5f5f : 0x363636) : (index === 0 ? 0xb6b6b6 : 0xd1d1d1));
      gridMaterial.opacity = nightMode ? 0.16 : 0.18;
      gridMaterial.transparent = true;
      gridMaterial.depthWrite = false;
    });
    carGroupsRef.current.forEach((car) => {
      const headlights = car.userData.headlights as THREE.Group | undefined;
      if (headlights) headlights.visible = nightMode;
    });
  }, [nightMode, layoutWidth, layoutHeight]);

  useEffect(() => {
    const group = trackGroupRef.current;
    if (!group) return;
    clearGroup(group);

    const bedMaterial = new THREE.MeshStandardMaterial({
      color: 0x8d8d8d,
      roughness: 0.9,
      metalness: 0.02
    });
    const railMaterial = new THREE.MeshStandardMaterial({
      color: 0x3d3d3d,
      roughness: 0.28,
      metalness: 0.78
    });

    const trails = mergeTrackPolylines(tracks, layoutWidth, layoutHeight);
    for (const trail of trails) {
      const bed = new THREE.Mesh(
        createRibbonGeometry(trail.points, 18.5, trail.closed),
        bedMaterial
      );
      bed.receiveShadow = true;
      group.add(bed);

      for (const offset of [-4.5, 4.5]) {
        const offsetPoints = offsetPolyline(trail.points, offset, trail.closed).map(
            (point) => new THREE.Vector3(point.x, 3.1, point.z)
          );
        const railPoints = trail.closed
          ? offsetPoints
          : extendPolylineEnds(offsetPoints, 1);
        const curve = new THREE.CatmullRomCurve3(
          railPoints,
          trail.closed,
          "centripetal",
          0.2
        );
        const geometry = new THREE.TubeGeometry(
          curve,
          Math.max(8, railPoints.length * 3),
          1.15,
          6,
          trail.closed
        );
        const rail = new THREE.Mesh(geometry, railMaterial);
        rail.castShadow = true;
        group.add(rail);
      }
    }

    const indicatorGroup = new THREE.Group();
    turnouts.forEach((turnout, index) => {
      const routePoints = turnout.route === "branch" ? turnout.branchPoints : turnout.mainPoints;
      addTurnoutRouteIndicator(
        indicatorGroup,
        routePoints,
        turnout.route === "branch",
        `#${index + 1}`,
        showTurnoutLabels,
        layoutWidth,
        layoutHeight
      );
    });
    group.add(indicatorGroup);
  }, [tracks, turnouts, showTurnoutLabels, layoutWidth, layoutHeight]);

  useEffect(() => {
    const offsets = trainRoute.totalLength >= TRAIN_CAR_CENTER_SPACING_MM
      ? [0, TRAIN_CAR_CENTER_SPACING_MM]
      : [0];
    carGroupsRef.current.forEach((car, index) => {
      const offset = offsets[index];
      const pose = offset === undefined
        ? null
        : sampleTrainRoute(
          trainRoute,
          trainDistance - (trainReversed ? -offset : offset),
          trainReversed
        );
      car.visible = showTrain && Boolean(pose);
      if (!pose) return;
      car.position.set(
        pose.x - layoutWidth / 2,
        trainRailHeight,
        pose.y - layoutHeight / 2
      );
      car.rotation.y = THREE.MathUtils.degToRad(-pose.angle);
    });
  }, [trainRoute, trainDistance, trainReversed, layoutWidth, layoutHeight, showTrain]);

  return (
    <div
      className="layout-3d-view"
      ref={hostRef}
      data-train-distance={trainDistance.toFixed(2)}
    >
      <button
        className="camera-reset-button"
        type="button"
        onClick={resetCamera}
        aria-label="重設 3D 視角"
        title="重設 3D 視角"
      >
        <Maximize2 size={18} />
      </button>
    </div>
  );
}

function addTurnoutRouteIndicator(
  group: THREE.Group,
  points: { x: number; y: number }[],
  isBranch: boolean,
  label: string,
  showLabel: boolean,
  layoutWidth: number,
  layoutHeight: number
) {
  if (points.length < 2) return;
  const routePoints = points.map((point) => new THREE.Vector3(
    point.x - layoutWidth / 2,
    2.1,
    point.y - layoutHeight / 2
  ));
  const highlight = new THREE.Mesh(
    createRibbonGeometry(routePoints, 14, false),
    new THREE.MeshBasicMaterial({
      color: 0xff8a22,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false
    })
  );
  highlight.renderOrder = 0;

  // Put the turnout number beyond the frog on a diverging route. The colored
  // route itself is the visual direction indicator.
  const middleIndex = Math.max(
    1,
    Math.floor((points.length - 1) * (isBranch ? 0.78 : 0.56))
  );
  const center = points[middleIndex];
  const origin = new THREE.Vector3(
    center.x - layoutWidth / 2,
    trainRailHeight,
    center.y - layoutHeight / 2
  );
  group.add(highlight);
  if (showLabel) {
    const badge = createTurnoutNumberBadge(label);
    badge.position.copy(origin);
    badge.position.y += 17;
    group.add(badge);
  }
}

function createTurnoutNumberBadge(label: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 100;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.Sprite();

  context.fillStyle = "rgba(30, 30, 30, 0.94)";
  context.beginPath();
  context.roundRect(4, 4, 184, 92, 22);
  context.fill();
  context.strokeStyle = "#ee6a24";
  context.lineWidth = 4;
  context.stroke();
  context.fillStyle = "#ffffff";
  context.font = "700 50px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, 96, 52);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(52, 27, 1);
  return sprite;
}

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && (
    target.matches("input, textarea, select") || target.isContentEditable
  );
}

function normalizeCameraMoveKey(key: string) {
  const normalized = key.toLowerCase();
  return ["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"]
    .includes(normalized)
    ? normalized
    : null;
}

function getCameraMovement(
  pressedKeys: Set<string>,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls
) {
  const forward = controls.target
    .clone()
    .sub(camera.position)
    .setY(0)
    .normalize();
  const right = forward.clone().cross(camera.up).normalize();
  const movement = new THREE.Vector3();

  if (pressedKeys.has("arrowup") || pressedKeys.has("w")) movement.add(forward);
  if (pressedKeys.has("arrowdown") || pressedKeys.has("s")) movement.sub(forward);
  if (pressedKeys.has("arrowleft") || pressedKeys.has("a")) movement.sub(right);
  if (pressedKeys.has("arrowright") || pressedKeys.has("d")) movement.add(right);
  return movement.lengthSq() > 0 ? movement.normalize() : movement;
}

function positionCamera(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  width: number,
  height: number
) {
  const extent = Math.max(width, height);
  camera.position.set(extent * 0.38, extent * 0.62, extent * 0.72);
  controls.target.set(0, 0, 0);
  controls.update();
}

function mergeTrackPolylines(
  tracks: TrackPolyline[],
  layoutWidth: number,
  layoutHeight: number
): TrackTrail[] {
  const remaining = tracks
    .filter((track) => track.points.length >= 2)
    .map((track) => track.points.map((point) =>
      new THREE.Vector3(
        point.x - layoutWidth / 2,
        1.2,
        point.y - layoutHeight / 2
      )
    ));
  const trails: TrackTrail[] = [];

  while (remaining.length > 0) {
    let points = remaining.shift() ?? [];
    points = extendTrail(points, remaining);
    points.reverse();
    points = extendTrail(points, remaining);
    points.reverse();

    const closed = points.length > 2 &&
      points[0].distanceTo(points[points.length - 1]) <= trackJoinTolerance;
    if (closed) {
      const last = points.pop();
      if (last) points[0].lerp(last, 0.5);
    }
    trails.push({ points, closed });
  }

  return trails;
}

function extendTrail(points: THREE.Vector3[], remaining: THREE.Vector3[][]) {
  while (points.length >= 2) {
    const end = points[points.length - 1];
    const direction = end.clone().sub(points[points.length - 2]).normalize();
    let bestIndex = -1;
    let bestReversed = false;
    let bestAlignment = -Infinity;

    remaining.forEach((candidate, index) => {
      const options = [
        { reversed: false, point: candidate[0], next: candidate[1] },
        {
          reversed: true,
          point: candidate[candidate.length - 1],
          next: candidate[candidate.length - 2]
        }
      ];
      for (const option of options) {
        if (end.distanceTo(option.point) > trackJoinTolerance) continue;
        const alignment = option.next.clone().sub(option.point).normalize().dot(direction);
        if (alignment > bestAlignment) {
          bestIndex = index;
          bestReversed = option.reversed;
          bestAlignment = alignment;
        }
      }
    });

    if (bestIndex < 0) break;
    const candidate = remaining.splice(bestIndex, 1)[0];
    if (bestReversed) candidate.reverse();
    const join = end.clone().lerp(candidate[0], 0.5);
    points[points.length - 1] = join;
    candidate[0] = join;
    points.push(...candidate.slice(1));
  }
  return points;
}

function createRibbonGeometry(
  points: THREE.Vector3[],
  width: number,
  closed: boolean
) {
  const positions: number[] = [];
  const indices: number[] = [];
  const half = width / 2;
  points.forEach((point, index) => {
    const previous = closed
      ? points[(index - 1 + points.length) % points.length]
      : points[Math.max(0, index - 1)];
    const next = closed
      ? points[(index + 1) % points.length]
      : points[Math.min(points.length - 1, index + 1)];
    const dx = next.x - previous.x;
    const dz = next.z - previous.z;
    const length = Math.hypot(dx, dz) || 1;
    const normalX = -dz / length;
    const normalZ = dx / length;
    positions.push(
      point.x + normalX * half, point.y, point.z + normalZ * half,
      point.x - normalX * half, point.y, point.z - normalZ * half
    );
  });
  const segmentCount = closed ? points.length : points.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const nextIndex = (index + 1) % points.length;
    const base = index * 2;
    const nextBase = nextIndex * 2;
    indices.push(
      base, base + 1, nextBase,
      base + 1, nextBase + 1, nextBase
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function offsetPolyline(points: THREE.Vector3[], offset: number, closed: boolean) {
  return points.map((point, index) => {
    const previous = closed
      ? points[(index - 1 + points.length) % points.length]
      : points[Math.max(0, index - 1)];
    const next = closed
      ? points[(index + 1) % points.length]
      : points[Math.min(points.length - 1, index + 1)];
    const dx = next.x - previous.x;
    const dz = next.z - previous.z;
    const length = Math.hypot(dx, dz) || 1;
    return new THREE.Vector3(
      point.x + (-dz / length) * offset,
      point.y,
      point.z + (dx / length) * offset
    );
  });
}

function extendPolylineEnds(points: THREE.Vector3[], distance: number) {
  if (points.length < 2) return points;

  const extended = points.map((point) => point.clone());
  const startDirection = extended[0]
    .clone()
    .sub(extended[1])
    .normalize()
    .multiplyScalar(distance);
  const lastIndex = extended.length - 1;
  const endDirection = extended[lastIndex]
    .clone()
    .sub(extended[lastIndex - 1])
    .normalize()
    .multiplyScalar(distance);
  extended[0].add(startDirection);
  extended[lastIndex].add(endDirection);
  return extended;
}

function createTrainCar(lead: boolean) {
  const group = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: lead ? 0xee6a24 : 0xe6e6e6,
    roughness: 0.45,
    metalness: 0.18
  });
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: 0x303030,
    roughness: 0.25,
    metalness: 0.42
  });
  const stripeMaterial = new THREE.MeshStandardMaterial({ color: 0x8b8b8b });

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(TRAIN_CAR_LENGTH_MM, 14, 16),
    bodyMaterial
  );
  body.castShadow = true;
  body.position.y = 7;
  group.add(body);

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(TRAIN_CAR_LENGTH_MM - 6, 3, 14),
    darkMaterial
  );
  roof.position.y = 15.5;
  roof.castShadow = true;
  group.add(roof);

  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(TRAIN_CAR_LENGTH_MM - 4, 2, 16.4),
    stripeMaterial
  );
  stripe.position.y = 5;
  group.add(stripe);

  for (const x of [-48, -29, -10, 10, 29, 48]) {
    for (const z of [-8.25, 8.25]) {
      const window = new THREE.Mesh(new THREE.BoxGeometry(14, 5, 0.8), darkMaterial);
      window.position.set(x, 9, z);
      group.add(window);
    }
  }

  if (lead) {
    const headlights = new THREE.Group();
    for (const z of [-5.4, 5.4]) {
      const lens = new THREE.Mesh(
        new THREE.SphereGeometry(1.35, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xfff1c1 })
      );
      lens.position.set(TRAIN_CAR_LENGTH_MM / 2 + 0.25, 8, z);
      headlights.add(lens);

      const light = new THREE.PointLight(0xffd58a, 2.8, 100, 1.8);
      light.position.set(TRAIN_CAR_LENGTH_MM / 2 + 3, 8, z);
      headlights.add(light);
    }
    headlights.visible = false;
    group.userData.headlights = headlights;
    group.add(headlights);
  }
  return group;
}

function clearGroup(group: THREE.Group) {
  while (group.children.length > 0) {
    const child = group.children.pop();
    if (child) disposeObject(child);
  }
}

function disposeObject(object: THREE.Object3D) {
  const mesh = object as THREE.Mesh;
  mesh.geometry?.dispose();
  if (Array.isArray(mesh.material)) {
    mesh.material.forEach((material) => material.dispose());
  } else {
    mesh.material?.dispose();
  }
}
