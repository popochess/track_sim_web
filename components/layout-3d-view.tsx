"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent
} from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react";
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
  tableEdgeMaterial: THREE.LineBasicMaterial;
  gridMaterials: THREE.Material[];
};

type TrackTrail = {
  points: THREE.Vector3[];
  closed: boolean;
};

const trainRailHeight = 4.6;
const trackJoinTolerance = 2;
type CameraMoveKey = "arrowup" | "arrowdown" | "arrowleft" | "arrowright";

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
  const cameraButtonKeysRef = useRef(new Set<CameraMoveKey>());

  const resetCamera = useCallback(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    positionCamera(camera, controls, layoutWidth, layoutHeight);
  }, [layoutWidth, layoutHeight]);

  const startCameraMove = useCallback((
    key: CameraMoveKey,
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    cameraButtonKeysRef.current.add(key);

    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const movement = getCameraMovement(new Set([key]), camera, controls).multiplyScalar(12);
    camera.position.add(movement);
    controls.target.add(movement);
    controls.update();
  }, []);

  const stopCameraMove = useCallback((key: CameraMoveKey) => {
    cameraButtonKeysRef.current.delete(key);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const sceneExtent = Math.hypot(layoutWidth, layoutHeight);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xd8d8d8);
    scene.fog = new THREE.Fog(0xd8d8d8, sceneExtent * 3, sceneExtent * 7);

    const camera = new THREE.PerspectiveCamera(42, 1, 1, sceneExtent * 9);
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
    controls.maxDistance = Math.max(4200, sceneExtent * 3.5);
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
      cameraButtonKeysRef.current.clear();
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

    const tableMaterial = new THREE.MeshStandardMaterial({
      color: 0xefefef,
      emissive: 0x000000,
      emissiveIntensity: 0,
      roughness: 0.92
    });
    const table = new THREE.Mesh(
      new THREE.BoxGeometry(layoutWidth, 18, layoutHeight),
      tableMaterial
    );
    table.position.y = -10;
    table.receiveShadow = true;
    scene.add(table);

    const tableEdgeMaterial = new THREE.LineBasicMaterial({
      color: 0xaebec5,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    });
    const tableEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(table.geometry),
      tableEdgeMaterial
    );
    tableEdges.renderOrder = 1;
    table.add(tableEdges);

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
      tableEdgeMaterial,
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
      const activeKeys = new Set<string>(pressedKeys);
      cameraButtonKeysRef.current.forEach((key) => activeKeys.add(key));
      const input = getCameraMovement(activeKeys, camera, controls);
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
      cameraButtonKeysRef.current.clear();
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

    if (rendererRef.current) {
      rendererRef.current.toneMappingExposure = nightMode ? 1.18 : 1.05;
    }

    theme.scene.background = new THREE.Color(nightMode ? 0x101214 : 0xd8d8d8);
    theme.fog.color.set(nightMode ? 0x101214 : 0xd8d8d8);
    theme.hemisphere.color.set(nightMode ? 0x233042 : 0xf5f5f5);
    theme.hemisphere.groundColor.set(nightMode ? 0x050607 : 0x575757);
    theme.hemisphere.intensity = nightMode ? 0.48 : 2.15;
    theme.sun.color.set(nightMode ? 0x9fb6d6 : 0xffffff);
    theme.sun.intensity = nightMode ? 0.52 : 2.6;
    theme.tableMaterial.color.set(nightMode ? 0x343b40 : 0xefefef);
    theme.tableMaterial.emissive.set(nightMode ? 0x263840 : 0x000000);
    theme.tableMaterial.emissiveIntensity = nightMode ? 0.44 : 0;
    theme.tableEdgeMaterial.color.set(nightMode ? 0xb7d2dc : 0xaebec5);
    theme.tableEdgeMaterial.opacity = nightMode ? 0.34 : 0.12;
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
      const interiorLights = car.userData.interiorLights as THREE.Group | undefined;
      if (interiorLights) interiorLights.visible = nightMode;
      const windowMaterial = car.userData.windowMaterial as THREE.MeshStandardMaterial | undefined;
      if (windowMaterial) {
        windowMaterial.color.set(nightMode ? 0xffd89a : 0x172126);
        windowMaterial.emissive.set(nightMode ? 0xffbd62 : 0x000000);
        windowMaterial.emissiveIntensity = nightMode ? 1.35 : 0;
        windowMaterial.roughness = nightMode ? 0.42 : 0.16;
        windowMaterial.metalness = nightMode ? 0.08 : 0.58;
      }
      const headlightLensMaterial = car.userData.headlightLensMaterial as THREE.MeshBasicMaterial | undefined;
      if (headlightLensMaterial) {
        headlightLensMaterial.color.set(nightMode ? 0xffffe8 : 0xffffd1);
      }
    });
  }, [nightMode, layoutWidth, layoutHeight]);

  useEffect(() => {
    const group = trackGroupRef.current;
    if (!group) return;
    clearGroup(group);

    const bedMaterial = new THREE.MeshStandardMaterial({
      color: nightMode ? 0x939fa5 : 0x8d8d8d,
      emissive: nightMode ? 0xd9e8ee : 0x000000,
      emissiveIntensity: nightMode ? 0.38 : 0,
      roughness: 0.9,
      metalness: 0.02
    });
    const bedGlowMaterial = nightMode
      ? new THREE.MeshBasicMaterial({
          color: 0xcce2ea,
          transparent: true,
          opacity: 0.28,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false
        })
      : null;
    const railMaterial = new THREE.MeshStandardMaterial({
      color: nightMode ? 0xd8e0e5 : 0x3d3d3d,
      emissive: nightMode ? 0xe8f1f5 : 0x000000,
      emissiveIntensity: nightMode ? 0.52 : 0,
      roughness: nightMode ? 0.42 : 0.28,
      metalness: nightMode ? 0.58 : 0.78
    });
    const railGlowMaterial = nightMode
      ? new THREE.MeshBasicMaterial({
          color: 0xe6f2f7,
          transparent: true,
          opacity: 0.13,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false
        })
      : null;

    const trails = mergeTrackPolylines(tracks, layoutWidth, layoutHeight);
    for (const trail of trails) {
      if (bedGlowMaterial) {
        const glowPoints = trail.points.map(
          (point) => new THREE.Vector3(point.x, point.y - 0.12, point.z)
        );
        const bedGlow = new THREE.Mesh(
          createRibbonGeometry(glowPoints, 29, trail.closed),
          bedGlowMaterial
        );
        bedGlow.renderOrder = 0;
        group.add(bedGlow);
      }
      const bed = new THREE.Mesh(
        createRibbonGeometry(trail.points, 18.5, trail.closed),
        bedMaterial
      );
      bed.receiveShadow = true;
      bed.renderOrder = 1;
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
        if (railGlowMaterial) {
          const glow = new THREE.Mesh(
            new THREE.TubeGeometry(
              curve,
              Math.max(8, railPoints.length * 3),
              2.7,
              6,
              trail.closed
            ),
            railGlowMaterial
          );
          glow.renderOrder = 1;
          group.add(glow);
        }
        const rail = new THREE.Mesh(geometry, railMaterial);
        rail.castShadow = true;
        rail.renderOrder = 2;
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
  }, [tracks, turnouts, showTurnoutLabels, layoutWidth, layoutHeight, nightMode]);

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
        重設視角
      </button>
      <div className="mobile-camera-pad" role="group" aria-label="移動 3D 相機視角">
        {([
          ["arrowup", "向上移動視角", ArrowUp, "camera-move-up"],
          ["arrowleft", "向左移動視角", ArrowLeft, "camera-move-left"],
          ["arrowright", "向右移動視角", ArrowRight, "camera-move-right"],
          ["arrowdown", "向下移動視角", ArrowDown, "camera-move-down"]
        ] as const).map(([key, label, Icon, className]) => (
          <button
            className={className}
            type="button"
            key={key}
            aria-label={label}
            title={label}
            onPointerDown={(event) => startCameraMove(key, event)}
            onPointerUp={() => stopCameraMove(key)}
            onPointerCancel={() => stopCameraMove(key)}
            onLostPointerCapture={() => stopCameraMove(key)}
          >
            <Icon size={19} strokeWidth={2.25} />
          </button>
        ))}
      </div>
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

function createRadialGlowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
    gradient.addColorStop(0.16, "rgba(255, 255, 255, 0.82)");
    gradient.addColorStop(0.46, "rgba(255, 255, 255, 0.24)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createHeadlightPoolTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    const forwardFade = context.createLinearGradient(0, 0, 256, 0);
    forwardFade.addColorStop(0, "rgba(255, 255, 255, 0.8)");
    forwardFade.addColorStop(0.18, "rgba(255, 255, 255, 0.52)");
    forwardFade.addColorStop(0.58, "rgba(255, 255, 255, 0.16)");
    forwardFade.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.fillStyle = forwardFade;
    context.fillRect(0, 0, 256, 128);

    context.globalCompositeOperation = "destination-in";
    const edgeFade = context.createLinearGradient(0, 0, 0, 128);
    edgeFade.addColorStop(0, "rgba(255, 255, 255, 0)");
    edgeFade.addColorStop(0.3, "rgba(255, 255, 255, 0.78)");
    edgeFade.addColorStop(0.5, "rgba(255, 255, 255, 1)");
    edgeFade.addColorStop(0.7, "rgba(255, 255, 255, 0.78)");
    edgeFade.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.fillStyle = edgeFade;
    context.fillRect(0, 0, 256, 128);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createTrainCar(lead: boolean) {
  const group = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: lead ? 0xed5d1c : 0xc7c7c7,
    roughness: 0.43,
    metalness: 0.2
  });
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: 0x24282a,
    roughness: 0.25,
    metalness: 0.42
  });
  const windowMaterial = new THREE.MeshStandardMaterial({
    color: 0x172126,
    emissive: 0x000000,
    emissiveIntensity: 0,
    roughness: 0.16,
    metalness: 0.58
  });
  group.userData.windowMaterial = windowMaterial;
  const stripeMaterial = new THREE.MeshStandardMaterial({
    color: 0xf5a13a,
    roughness: 0.35,
    metalness: 0.18
  });

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(TRAIN_CAR_LENGTH_MM, 15, 18),
    bodyMaterial
  );
  body.castShadow = true;
  body.position.y = 8.5;
  group.add(body);

  const underframe = new THREE.Mesh(
    new THREE.BoxGeometry(TRAIN_CAR_LENGTH_MM - 8, 4, 16),
    darkMaterial
  );
  underframe.position.y = 1.5;
  underframe.castShadow = true;
  group.add(underframe);

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(TRAIN_CAR_LENGTH_MM - 16, 4, 15),
    darkMaterial
  );
  roof.position.y = 18;
  roof.castShadow = true;
  group.add(roof);

  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(TRAIN_CAR_LENGTH_MM - 8, 2, 18.5),
    stripeMaterial
  );
  stripe.position.y = 6;
  group.add(stripe);

  if (lead) {
    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(20, 9, 18.8),
      darkMaterial
    );
    cab.position.set(TRAIN_CAR_LENGTH_MM / 2 - 9.5, 13, 0);
    cab.castShadow = true;
    group.add(cab);

    const windscreen = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 6, 12.5),
      windowMaterial
    );
    windscreen.position.set(TRAIN_CAR_LENGTH_MM / 2 + 0.95, 14, 0);
    group.add(windscreen);

    for (const z of [-9.45, 9.45]) {
      const cabWindow = new THREE.Mesh(
        new THREE.BoxGeometry(10, 5.5, 0.75),
        windowMaterial
      );
      cabWindow.position.set(TRAIN_CAR_LENGTH_MM / 2 - 10, 14, z);
      group.add(cabWindow);
    }

    const lampBezelMaterial = new THREE.MeshStandardMaterial({
      color: 0x111315,
      roughness: 0.32,
      metalness: 0.5
    });
    const lampMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffd1,
      toneMapped: false
    });
    group.userData.headlightLensMaterial = lampMaterial;
    for (const z of [-5.7, 5.7]) {
      const bezel = new THREE.Mesh(
        new THREE.CylinderGeometry(2.2, 2.2, 0.55, 16),
        lampBezelMaterial
      );
      bezel.rotation.z = -Math.PI / 2;
      bezel.position.set(TRAIN_CAR_LENGTH_MM / 2 + 0.75, 8.4, z);
      group.add(bezel);

      const lens = new THREE.Mesh(
        new THREE.CylinderGeometry(1.38, 1.38, 0.62, 16),
        lampMaterial
      );
      lens.rotation.z = -Math.PI / 2;
      lens.position.set(TRAIN_CAR_LENGTH_MM / 2 + 1.15, 8.4, z);
      group.add(lens);
    }
    for (const z of [-2.45, 2.45]) {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(1.15, 12, 8),
        lampMaterial
      );
      marker.position.set(TRAIN_CAR_LENGTH_MM / 2 + 0.9, 17.5, z);
      group.add(marker);
    }

    const logo = createE500Logo();
    logo.position.set(TRAIN_CAR_LENGTH_MM / 2 + 1.3, 8.3, 0);
    group.add(logo);

    for (const x of [-24, 4, 28]) {
      const equipment = new THREE.Mesh(
        new THREE.BoxGeometry(14, 2.2, 7),
        new THREE.MeshStandardMaterial({ color: 0x8f9697, roughness: 0.55 })
      );
      equipment.position.set(x, 21.1, 0);
      group.add(equipment);
    }
  } else {
    for (const x of [-47, -28, -9, 10, 29, 48]) {
      for (const z of [-9.45, 9.45]) {
        const window = new THREE.Mesh(
          new THREE.BoxGeometry(13.5, 5.4, 0.75),
          windowMaterial
        );
        window.position.set(x, 12, z);
        group.add(window);
      }
    }
  }

  const interiorLights = new THREE.Group();
  for (const x of [-30, 30]) {
    const light = new THREE.PointLight(0xffc978, 1.4, 72, 1.8);
    light.position.set(x, 12.5, 0);
    interiorLights.add(light);
  }
  interiorLights.visible = false;
  group.userData.interiorLights = interiorLights;
  group.add(interiorLights);

  if (lead) {
    const headlights = new THREE.Group();
    const headlightGlowMaterial = new THREE.SpriteMaterial({
      map: createRadialGlowTexture(),
      color: 0xffe8b8,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    });
    const headlightHaloMaterial = new THREE.SpriteMaterial({
      map: createRadialGlowTexture(),
      color: 0xfff2d2,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    });
    for (const z of [-5.4, 5.4]) {
      const light = new THREE.PointLight(0xffe3b0, 16, 290, 1.3);
      light.position.set(TRAIN_CAR_LENGTH_MM / 2 + 4.5, 8.4, z);
      headlights.add(light);

      const glow = new THREE.Sprite(headlightGlowMaterial);
      glow.scale.set(9, 9, 1);
      glow.position.copy(light.position);
      headlights.add(glow);

      const halo = new THREE.Sprite(headlightHaloMaterial);
      halo.scale.set(18, 18, 1);
      halo.position.copy(light.position);
      headlights.add(halo);
    }
    const beam = new THREE.SpotLight(0xffe8bd, 48, 520, 0.27, 0.82, 1.15);
    beam.position.set(TRAIN_CAR_LENGTH_MM / 2 + 4.5, 9, 0);
    beam.target.position.set(TRAIN_CAR_LENGTH_MM / 2 + 280, 1, 0);
    headlights.add(beam, beam.target);

    const groundLight = new THREE.Mesh(
      new THREE.PlaneGeometry(270, 76),
      new THREE.MeshBasicMaterial({
        map: createHeadlightPoolTexture(),
        color: 0xffe6ae,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      })
    );
    groundLight.rotation.x = -Math.PI / 2;
    groundLight.position.set(TRAIN_CAR_LENGTH_MM / 2 + 137, 1.35, 0);
    groundLight.renderOrder = 3;
    headlights.add(groundLight);
    headlights.visible = false;
    group.userData.headlights = headlights;
    group.add(headlights);
  }
  return group;
}

function createE500Logo() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.Group();

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#ffffff";
  context.font = "italic 900 92px Arial, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("R", 63, 68);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false
  });
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 5.5), material);
  logo.rotation.y = Math.PI / 2;
  return logo;
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
