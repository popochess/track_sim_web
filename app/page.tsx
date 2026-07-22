"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Box,
  Check,
  ChevronDown,
  CircleDot,
  Copy,
  Crosshair,
  Download,
  Eye,
  EyeOff,
  GitFork,
  Grid2X2,
  Hand,
  MousePointer2,
  Move,
  Moon,
  Pause,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  RotateCw,
  Trash2,
  Undo2,
  Sun,
  Upload,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import {
  getTrackBounds,
  TrackGhost,
  TrackShape
} from "../components/track-shape";
import { Layout3DView } from "../components/layout-3d-view";
import {
  TOMIX_TRACKS,
  TOMIX_TRACK_SETS,
  TrackDefinition,
  TrackKind,
  TrackSetDefinition
} from "../lib/tomix-tracks";
import {
  buildTrackPolylines,
  buildTurnoutIndicators,
  buildTrainRoute,
  getClosestRouteDistance,
  sampleTrainRoute,
  TRAIN_CAR_CENTER_SPACING_MM,
  TRAIN_CAR_LENGTH_MM,
  TrainRoute,
  TrainRouteAnchor,
  TrainPose,
  TurnoutRoute
} from "../lib/train-simulation";

type PlacedTrack = {
  id: string;
  trackId: string;
  x: number;
  y: number;
  rotation: number;
  turnoutRoute?: TurnoutRoute;
};

type LayoutSnapshot = {
  layoutWidth: number;
  layoutHeight: number;
  zoom: number;
  panOffset: { x: number; y: number };
  placed: PlacedTrack[];
  selectedPlacedIds: string[];
};

type LayoutHistory = {
  past: LayoutSnapshot[];
  future: LayoutSnapshot[];
};

type LayoutExportFile = {
  format: "tomix-layout-planner";
  version: 1;
  exportedAt: string;
  layout: LayoutSnapshot;
};

type DragState = {
  ids: string[];
  offsetX: number;
  offsetY: number;
  startX: number;
  startY: number;
  origins: Record<string, { x: number; y: number }>;
};

type MarqueeState = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PanState = {
  pointerX: number;
  pointerY: number;
  startPanX: number;
  startPanY: number;
};

type RotateState = {
  ids: string[];
  pivotX: number;
  pivotY: number;
  startAngle: number;
  origins: Record<
    string,
    {
      x: number;
      y: number;
      rotation: number;
    }
  >;
  pointerX: number;
  pointerY: number;
  displayAngle: number;
};

type TrackEndpoint = {
  x: number;
  y: number;
  angle: number;
};

type WorldTrackEndpoint = TrackEndpoint & {
  itemId: string;
};

type TrainDebugEvent = {
  sequence: number;
  action: string;
  detail: string;
};

const kindLabels: Record<TrackKind, string> = {
  straight: "直線",
  curve: "彎軌",
  turnout: "岔軌",
  adapter: "特殊"
};

const kindOrder: TrackKind[] = ["straight", "curve", "turnout", "adapter"];
const canvasPadding = 80;
const horizontalAxisLeadingPadding = 180;
const maxHistorySize = 80;
const snapDistanceMm = 60;
const layoutStorageKey = "tomix-layout-planner:layout-v1";
const trainDebugEventLimit = 60;

export default function Home() {
  const [layoutWidth, setLayoutWidth] = useState(1800);
  const [layoutHeight, setLayoutHeight] = useState(900);
  const [zoom, setZoom] = useState(1.6);
  const [activeKind, setActiveKind] = useState<TrackKind>("curve");
  const [libraryMode, setLibraryMode] = useState<"tracks" | "sets">("tracks");
  const [selectedTrackId, setSelectedTrackId] = useState("C280-45");
  const [selectedSetId, setSelectedSetId] = useState("basic-a");
  const [placed, setPlaced] = useState<PlacedTrack[]>([]);
  const [selectedPlacedIds, setSelectedPlacedIds] = useState<string[]>([]);
  const [history, setHistory] = useState<LayoutHistory>({ past: [], future: [] });
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [panning, setPanning] = useState<PanState | null>(null);
  const [rotating, setRotating] = useState<RotateState | null>(null);
  const [panMode, setPanMode] = useState(false);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [selectionDetailsExpanded, setSelectionDetailsExpanded] = useState(false);
  const [trainRunning, setTrainRunning] = useState(false);
  const [showTrain, setShowTrain] = useState(false);
  const [trainDistance, setTrainDistance] = useState(0);
  const [trainSpeed, setTrainSpeed] = useState(160);
  const [trainDirection, setTrainDirection] = useState<1 | -1>(1);
  const [trainStopReason, setTrainStopReason] = useState("尚未啟動列車");
  const [trainDebugEvents, setTrainDebugEvents] = useState<TrainDebugEvent[]>([]);
  const [trainDebugCopyState, setTrainDebugCopyState] = useState<
    "idle" | "copied" | "failed"
  >("idle");
  const [layoutFileStatus, setLayoutFileStatus] = useState<
    "idle" | "exported" | "imported" | "error"
  >("idle");
  const [placingTrain, setPlacingTrain] = useState(false);
  const [trainRouteAnchor, setTrainRouteAnchor] = useState<TrainRouteAnchor | null>(null);
  const [viewMode, setViewMode] = useState<"2d" | "3d">("2d");
  const [nightMode, setNightMode] = useState(false);
  const [showTurnoutLabels, setShowTurnoutLabels] = useState(true);
  const [hasRestoredSavedLayout, setHasRestoredSavedLayout] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"library" | "inspector" | null>(null);
  const canvasFrameRef = useRef<HTMLDivElement | null>(null);
  const interactionSnapshotRef = useRef<LayoutSnapshot | null>(null);
  const trainFrameRef = useRef<number | null>(null);
  const previousTrainRouteRef = useRef<TrainRoute | null>(null);
  const pendingTrainPoseRef = useRef<TrainPose | null>(null);
  const trainDebugSequenceRef = useRef(0);
  const trainDebugInitializedRef = useRef(false);
  const terminalStopReportedRef = useRef(false);
  const layoutFileInputRef = useRef<HTMLInputElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  const trackMap = useMemo(
    () => new Map(TOMIX_TRACKS.map((track) => [track.id, track])),
    []
  );
  const trainRoute = useMemo(
    () => buildTrainRoute(placed, trackMap, trainRouteAnchor),
    [placed, trackMap, trainRouteAnchor]
  );
  const trackPolylines = useMemo(
    () => buildTrackPolylines(placed, trackMap),
    [placed, trackMap]
  );
  const turnoutIndicators = useMemo(
    () => buildTurnoutIndicators(placed, trackMap),
    [placed, trackMap]
  );
  const trainTravelDistance = trainDistance;
  const trainDebugReport = useMemo(() => {
    const pose = sampleTrainRoute(trainRoute, trainDistance, trainDirection === -1);
    const pointStates = placed.flatMap((item) => {
      const track = trackMap.get(item.trackId);
      return track?.kind === "turnout"
        ? [`${track.code} (${item.id.slice(-5)}): ${item.turnoutRoute === "branch" ? "分歧" : "直線"}`]
        : [];
    });
    const formatPoint = (value: number) => value.toFixed(1);

    return [
      "Train simulation debug",
      `status: ${trainRunning ? "running" : "stopped"}`,
      `reason: ${trainStopReason}`,
      `route: ${trainRoute.closed ? "closed loop" : "open route"}`,
      `segments: ${trainRoute.segmentCount}`,
      `length: ${trainRoute.totalLength.toFixed(1)} mm`,
      `distance: ${trainDistance.toFixed(1)} mm`,
      `position: ${pose ? `${formatPoint(pose.x)}, ${formatPoint(pose.y)}` : "unavailable"}`,
      `heading: ${pose ? `${formatPoint(pose.angle)} deg` : "unavailable"}`,
      `direction: ${trainDirection === 1 ? "right" : "left"}`,
      `speed: ${trainSpeed} mm/s`,
      `anchor: ${trainRouteAnchor ? `${formatPoint(trainRouteAnchor.point.x)}, ${formatPoint(trainRouteAnchor.point.y)}` : "none"}`,
      `anchor decision: ${trainRoute.debug?.anchor ?? "no anchor route decision"}`,
      `route trace: ${trainRoute.debug?.traversal.join(" -> ") ?? "not recorded"}`,
      `points: ${pointStates.length > 0 ? pointStates.join(" | ") : "none"}`,
      "",
      "timeline:",
      ...(trainDebugEvents.length > 0
        ? trainDebugEvents.map(
            (event) => `#${event.sequence} ${event.action}: ${event.detail}`
          )
        : ["(waiting for layout initialization)"])
    ].join("\n");
  }, [placed, trackMap, trainDebugEvents, trainDirection, trainDistance, trainRoute, trainRouteAnchor, trainRunning, trainSpeed, trainStopReason]);

  const copyTrainDebugReport = useCallback(async () => {
    let copied = false;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(trainDebugReport);
        copied = true;
      }
    } catch {
      // Embedded browsers can deny Clipboard permission. Use the selection fallback below.
    }

    if (!copied) {
      const fallback = document.createElement("textarea");
      fallback.value = trainDebugReport;
      fallback.setAttribute("readonly", "");
      fallback.style.position = "fixed";
      fallback.style.opacity = "0";
      fallback.style.pointerEvents = "none";
      document.body.appendChild(fallback);
      fallback.select();
      fallback.setSelectionRange(0, fallback.value.length);

      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }

      fallback.remove();
    }

    setTrainDebugCopyState(copied ? "copied" : "failed");
    window.setTimeout(() => setTrainDebugCopyState("idle"), 1800);
  }, [trainDebugReport]);

  const selectedTrack = trackMap.get(selectedTrackId) ?? TOMIX_TRACKS[0];
  const selectedSet =
    TOMIX_TRACK_SETS.find((set) => set.id === selectedSetId) ??
    TOMIX_TRACK_SETS[0];
  const selectedPlacedId = selectedPlacedIds[0] ?? null;
  const selectedPlaced = placed.find((track) => track.id === selectedPlacedId);
  const selectedPlacedDef = selectedPlaced
    ? trackMap.get(selectedPlaced.trackId)
    : undefined;
  const selectedBounds = useMemo(
    () => getSelectionBounds(placed, selectedPlacedIds, trackMap),
    [placed, selectedPlacedIds, trackMap]
  );
  const selectedTrackDetails = useMemo(() => {
    const selectedIds = new Set(selectedPlacedIds);
    return placed.flatMap((item) => {
      if (!selectedIds.has(item.id)) return [];
      const track = trackMap.get(item.trackId);
      return track ? [{ id: item.id, code: track.code }] : [];
    });
  }, [placed, selectedPlacedIds, trackMap]);
  const visibleSelectedTrackDetails = selectionDetailsExpanded
    ? selectedTrackDetails
    : selectedTrackDetails.slice(0, 10);
  const viewWidth = (layoutWidth + canvasPadding * 2) / zoom;
  const viewHeight = (layoutHeight + canvasPadding * 2) / zoom;
  const viewOrigin = getViewOrigin(layoutWidth, layoutHeight, viewWidth, viewHeight);
  const viewX = Math.max(-horizontalAxisLeadingPadding, viewOrigin.x + panOffset.x);
  const viewY = Math.max(0, viewOrigin.y + panOffset.y);
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const appendTrainDebugEvent = useCallback((action: string, detail: string) => {
    const sequence = ++trainDebugSequenceRef.current;
    setTrainDebugEvents((events) => [
      ...events,
      { sequence, action, detail }
    ].slice(-trainDebugEventLimit));
  }, []);

  useEffect(() => {
    setSelectionDetailsExpanded(false);
  }, [selectedPlacedIds]);

  useEffect(() => {
    if (!hasRestoredSavedLayout || trainDebugInitializedRef.current) return;
    trainDebugInitializedRef.current = true;
    appendTrainDebugEvent(
      "initial layout",
      describeLayoutForDebug(placed, trackMap)
    );
  }, [appendTrainDebugEvent, hasRestoredSavedLayout, placed, trackMap]);

  useEffect(() => {
    setPanOffset((offset) => {
      const clamped = clampPanOffset(offset, layoutWidth, layoutHeight, viewWidth, viewHeight);
      return clamped.x === offset.x && clamped.y === offset.y ? offset : clamped;
    });
  }, [layoutWidth, layoutHeight, viewWidth, viewHeight]);

  useEffect(() => {
    const previousRoute = previousTrainRouteRef.current;
    const preservedPose = pendingTrainPoseRef.current;
    pendingTrainPoseRef.current = null;
    previousTrainRouteRef.current = trainRoute;

    if (trainRoute.totalLength <= 0) {
      setTrainDistance(0);
      setTrainRunning(false);
      setTrainStopReason("沒有可行駛的連通路徑");
      if (hasRestoredSavedLayout) {
        appendTrainDebugEvent("route recalculated", "no connected route available");
      }
      return;
    }

    if (!previousRoute || previousRoute.totalLength <= 0) {
      setTrainDistance(0);
      return;
    }

    setTrainDistance((distance) => {
      const currentPose = preservedPose ?? sampleTrainRoute(previousRoute, distance);
      return currentPose
        ? getClosestRouteDistance(trainRoute, currentPose)
        : Math.min(distance, trainRoute.totalLength);
    });
    if (hasRestoredSavedLayout) {
      appendTrainDebugEvent(
        "route recalculated",
        `${trainRoute.closed ? "closed" : "open"}; segments=${trainRoute.segmentCount}; length=${trainRoute.totalLength.toFixed(1)} mm; anchor=${trainRouteAnchor ? "active" : "none"}; ${trainRoute.debug?.anchor ?? "no anchor decision"}; trace=${trainRoute.debug?.traversal.join(" -> ") ?? "not recorded"}`
      );
    }
  }, [appendTrainDebugEvent, hasRestoredSavedLayout, trainRoute, trainRouteAnchor]);

  useEffect(() => {
    if (!trainRunning || trainRoute.totalLength <= 0) return;

    let previousTime = performance.now();
    const tick = (time: number) => {
      const elapsedSeconds = Math.min((time - previousTime) / 1000, 0.1);
      previousTime = time;
      setTrainDistance((distance) => {
        const next = distance + elapsedSeconds * trainSpeed * trainDirection;
        if (!trainRoute.closed) {
          const reachedEnd = trainDirection === 1
            ? next >= trainRoute.totalLength
            : next <= 0;
          if (reachedEnd) {
            setTrainRunning(false);
            const endpointDistance = trainDirection === 1 ? trainRoute.totalLength : 0;
            const reason = `抵達開放路徑終點（${trainRoute.totalLength.toFixed(1)} mm）；請檢查該端是否有未接上的軌道或 point 路徑設定。`;
            setTrainStopReason(reason);
            if (!terminalStopReportedRef.current) {
              terminalStopReportedRef.current = true;
              appendTrainDebugEvent(
                "train stopped",
                `${reason} position=${formatTrainPose(sampleTrainRoute(trainRoute, endpointDistance, trainDirection === -1))}`
              );
            }
            return endpointDistance;
          }
        }
        return next;
      });
      trainFrameRef.current = requestAnimationFrame(tick);
    };

    trainFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (trainFrameRef.current !== null) {
        cancelAnimationFrame(trainFrameRef.current);
        trainFrameRef.current = null;
      }
    };
  }, [appendTrainDebugEvent, trainDirection, trainRoute, trainRunning, trainSpeed]);

  const createSnapshot = useCallback(
    (): LayoutSnapshot => ({
      layoutWidth,
      layoutHeight,
      zoom,
      panOffset,
      placed,
      selectedPlacedIds
    }),
    [layoutWidth, layoutHeight, zoom, panOffset, placed, selectedPlacedIds]
  );

  const restoreSnapshot = useCallback((snapshot: LayoutSnapshot) => {
    setLayoutWidth(snapshot.layoutWidth);
    setLayoutHeight(snapshot.layoutHeight);
    setZoom(snapshot.zoom);
    setPanOffset(snapshot.panOffset);
    setPlaced(snapshot.placed);
    setSelectedPlacedIds(snapshot.selectedPlacedIds);
  }, []);

  const saveLayout = useCallback(() => {
    try {
      localStorage.setItem(
        layoutStorageKey,
        JSON.stringify({
          layoutWidth,
          layoutHeight,
          zoom,
          panOffset,
          placed,
          selectedPlacedIds
        })
      );
      return true;
    } catch {
      return false;
    }
  }, [layoutHeight, layoutWidth, panOffset, placed, selectedPlacedIds, zoom]);

  const clearLayoutFileStatus = useCallback(() => {
    window.setTimeout(() => setLayoutFileStatus("idle"), 2200);
  }, []);

  const exportLayoutFile = useCallback(() => {
    const payload: LayoutExportFile = {
      format: "tomix-layout-planner",
      version: 1,
      exportedAt: new Date().toISOString(),
      layout: createSnapshot()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = payload.exportedAt.replace(/[:.]/g, "-");
    link.href = url;
    link.download = `tomix-layout-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setLayoutFileStatus("exported");
    clearLayoutFileStatus();
  }, [clearLayoutFileStatus, createSnapshot]);

  const importLayoutFile = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;

      try {
        const parsed = JSON.parse(await file.text()) as Partial<LayoutExportFile> | LayoutSnapshot;
        const source =
          typeof parsed === "object" && parsed !== null && "layout" in parsed
            ? (parsed as Partial<LayoutExportFile>).layout
            : parsed;
        const imported = readStoredLayout(JSON.stringify(source), trackMap);
        if (!imported) throw new Error("invalid layout file");

        restoreSnapshot(imported);
        setHistory({ past: [], future: [] });
        localStorage.setItem(layoutStorageKey, JSON.stringify(imported));
        setLayoutFileStatus("imported");
      } catch {
        setLayoutFileStatus("error");
      }

      clearLayoutFileStatus();
    },
    [clearLayoutFileStatus, restoreSnapshot, trackMap]
  );

  useEffect(() => {
    try {
      const savedLayout = readStoredLayout(localStorage.getItem(layoutStorageKey), trackMap);
      if (savedLayout) restoreSnapshot(savedLayout);
    } finally {
      setHasRestoredSavedLayout(true);
    }
  }, [restoreSnapshot, trackMap]);

  useEffect(() => {
    if (!hasRestoredSavedLayout) return;
    const timeout = window.setTimeout(saveLayout, 350);
    return () => window.clearTimeout(timeout);
  }, [hasRestoredSavedLayout, saveLayout]);

  const pushHistory = useCallback((snapshot: LayoutSnapshot) => {
    setHistory((items) => ({
      past: [...items.past, snapshot].slice(-maxHistorySize),
      future: []
    }));
  }, []);

  const commitHistoryFrom = useCallback(
    (before: LayoutSnapshot | null) => {
      if (!before) return;
      const after = createSnapshot();
      if (snapshotsEqual(before, after)) return;
      pushHistory(before);
    },
    [createSnapshot, pushHistory]
  );

  const undo = useCallback(() => {
    setHistory((items) => {
      const previous = items.past[items.past.length - 1];
      if (!previous) return items;

      const current = createSnapshot();
      restoreSnapshot(previous);
      return {
        past: items.past.slice(0, -1),
        future: [current, ...items.future].slice(0, maxHistorySize)
      };
    });
  }, [createSnapshot, restoreSnapshot]);

  const redo = useCallback(() => {
    setHistory((items) => {
      const next = items.future[0];
      if (!next) return items;

      const current = createSnapshot();
      restoreSnapshot(next);
      return {
        past: [...items.past, current].slice(-maxHistorySize),
        future: items.future.slice(1)
      };
    });
  }, [createSnapshot, restoreSnapshot]);

  useEffect(() => {
    const frame = canvasFrameRef.current;
    if (!frame) return;

    const updateSize = () => {
      const rect = frame.getBoundingClientRect();
      setCanvasSize({ width: rect.width, height: rect.height });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!mobilePanel) return;

    const closeMobilePanel = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobilePanel(null);
    };

    window.addEventListener("keydown", closeMobilePanel);
    return () => window.removeEventListener("keydown", closeMobilePanel);
  }, [mobilePanel]);

  useEffect(() => {
    if (viewMode === "3d" && mobilePanel === "library") {
      setMobilePanel(null);
    }
  }, [mobilePanel, viewMode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifierPressed = event.metaKey || event.ctrlKey;
      if (!modifierPressed || isEditableElement(event.target)) return;

      const key = event.key.toLowerCase();
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        redo();
        return;
      }

      if (key === "z") {
        event.preventDefault();
        undo();
        return;
      }

      if (key === "y") {
        event.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  const addTrackAt = (track: TrackDefinition, x: number, y: number) => {
    pushHistory(createSnapshot());
    const next: PlacedTrack = {
      id: `${track.id}-${createUniqueId()}`,
      trackId: track.id,
      x: Math.round(x),
      y: Math.round(y),
      rotation: track.kind === "curve" ? -90 : 0,
      turnoutRoute: track.kind === "turnout" ? "main" : undefined
    };
    setPlaced((items) => [...items, next]);
    setSelectedPlacedIds([next.id]);
  };

  const addTrack = (track: TrackDefinition = selectedTrack) => {
    addTrackAt(track, layoutWidth / 2, layoutHeight / 2);
  };

  const startTrackDrag = (
    event: React.DragEvent<HTMLButtonElement>,
    track: TrackDefinition
  ) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-tomix-track", track.id);
    event.dataTransfer.setData("text/plain", track.id);
  };

  const dropTrackOnCanvas = (event: React.DragEvent<SVGSVGElement>) => {
    event.preventDefault();
    const trackId = event.dataTransfer.getData("application/x-tomix-track");
    const track = trackMap.get(trackId);
    if (!track) return;

    const point = getSvgPoint(event.currentTarget, event);
    addTrackAt(track, point.x, point.y);
  };

  const addSet = (set: TrackSetDefinition = selectedSet) => {
    pushHistory(createSnapshot());
    const shouldUseSetCanvas = set.id === "image-plan-1200-600";
    const nextLayoutWidth = shouldUseSetCanvas ? set.layoutSize.width : layoutWidth;
    const nextLayoutHeight = shouldUseSetCanvas ? set.layoutSize.height : layoutHeight;
    const centerX = nextLayoutWidth / 2;
    const centerY = nextLayoutHeight / 2;
    const batchId = createUniqueId();
    const next: PlacedTrack[] = set.pieces.map((piece, index) => ({
      id: `${set.id}-${batchId}-${index}`,
      trackId: piece.trackId,
      x: Math.round(centerX + piece.x),
      y: Math.round(centerY + piece.y),
      rotation: piece.rotation,
      turnoutRoute: trackMap.get(piece.trackId)?.kind === "turnout" ? "main" : undefined
    }));
    if (shouldUseSetCanvas) {
      setLayoutWidth(nextLayoutWidth);
      setLayoutHeight(nextLayoutHeight);
      setZoom(1);
      setPanOffset({ x: 0, y: 0 });
    }
    setPlaced((items) => [...items, ...next]);
    setSelectedPlacedIds(next.map((item) => item.id));
  };

  const rotateSelected = (delta: number) => {
    if (selectedPlacedIds.length === 0) return;
    const bounds = getSelectionBounds(placed, selectedPlacedIds, trackMap);
    if (!bounds) return;
    pushHistory(createSnapshot());
    const selected = new Set(selectedPlacedIds);
    const pivotX = bounds.x + bounds.width / 2;
    const pivotY = bounds.y + bounds.height / 2;
    setPlaced((items) =>
      items.map((item) =>
        !selected.has(item.id)
          ? item
          : (() => {
              const rotatedPosition = rotatePoint(item.x - pivotX, item.y - pivotY, delta);
              return {
                ...item,
                x: roundLayoutValue(rotatedPosition.x + pivotX),
                y: roundLayoutValue(rotatedPosition.y + pivotY),
                rotation: normalizeAngle(item.rotation + delta)
              };
            })()
      )
    );
  };

  const removeSelected = useCallback(() => {
    if (selectedPlacedIds.length === 0) return;
    pushHistory(createSnapshot());
    const selected = new Set(selectedPlacedIds);
    setPlaced((items) => items.filter((item) => !selected.has(item.id)));
    setSelectedPlacedIds([]);
  }, [selectedPlacedIds, createSnapshot, pushHistory]);

  const anchorTrainRoute = (reverseHeading = false) => {
    const pose = sampleTrainRoute(trainRoute, trainDistance);
    if (!pose) return;
    pendingTrainPoseRef.current = pose;
    const angle = pose.angle + (reverseHeading ? 180 : 0);
    const radians = (angle * Math.PI) / 180;
    setTrainRouteAnchor({
      point: { x: pose.x, y: pose.y },
      heading: { x: Math.cos(radians), y: Math.sin(radians) }
    });
    setTrainDistance(0);
    return pose;
  };

  const changeTrainDirection = (direction: 1 | -1) => {
    if (direction !== trainDirection) {
      const pose = sampleTrainRoute(
        trainRoute,
        trainDistance,
        trainDirection === -1
      );
      appendTrainDebugEvent(
        "direction changed",
        `${trainDirection === 1 ? "right" : "left"} -> ${direction === 1 ? "right" : "left"}; at=${formatTrainPose(pose)}`
      );
    }
    setTrainDirection(direction);
  };

  const setTurnoutRoute = (id: string, turnoutRoute: TurnoutRoute) => {
    const currentRoute = placed.find((item) => item.id === id)?.turnoutRoute ?? "main";
    if (currentRoute === turnoutRoute) return;
    const pointTrack = placed.find((item) => item.id === id);
    const pointCode = pointTrack ? trackMap.get(pointTrack.trackId)?.code ?? id : id;
    const pose = anchorTrainRoute(trainDirection === -1);
    appendTrainDebugEvent(
      "point changed",
      `${pointCode} (${id.slice(-5)}): ${currentRoute === "branch" ? "branch" : "main"} -> ${turnoutRoute === "branch" ? "branch" : "main"}; at=${formatTrainPose(pose)}`
    );
    pushHistory(createSnapshot());
    setPlaced((items) =>
      items.map((item) => (item.id === id ? { ...item, turnoutRoute } : item))
    );
  };

  useEffect(() => {
    if (selectedPlacedIds.length === 0) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (isEditableElement(event.target)) return;

      event.preventDefault();
      removeSelected();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedPlacedIds, removeSelected]);

  const changeZoom = (nextZoom: number) => {
    setZoom(Math.max(0.5, Math.min(3, Number(nextZoom.toFixed(2)))));
  };

  const resetView = () => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  };

  const updateDraggedTrack = (
    event: React.PointerEvent<SVGSVGElement>,
    dragState: DragState
  ) => {
    const local = getSvgPoint(event.currentTarget, event);
    const deltaX = Math.round((local.x - dragState.startX) / 5) * 5;
    const deltaY = Math.round((local.y - dragState.startY) / 5) * 5;
    setPlaced((items) => {
      const moved = items.map((item) =>
        dragState.ids.includes(item.id)
          ? {
              ...item,
              x: (dragState.origins[item.id]?.x ?? item.x) + deltaX,
              y: (dragState.origins[item.id]?.y ?? item.y) + deltaY
            }
          : item
      );

      return snapDraggedTracks(moved, dragState.ids, trackMap);
    });
  };

  const startMarquee = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.button === 1 || event.button === 2 || panMode || event.shiftKey) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(null);
      setMarquee(null);
      setPanning({
        pointerX: event.clientX,
        pointerY: event.clientY,
        startPanX: panOffset.x,
        startPanY: panOffset.y
      });
      return;
    }

    if (event.button !== 0) return;
    const local = getSvgPoint(event.currentTarget, event);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(null);
    setSelectedPlacedIds([]);
    setMarquee({
      startX: local.x,
      startY: local.y,
      currentX: local.x,
      currentY: local.y
    });
  };

  const updatePan = (
    event: React.PointerEvent<SVGSVGElement>,
    panState: PanState
  ) => {
    const scale = getSvgScreenScale(canvasSize, viewWidth, viewHeight);
    if (scale === 0) return;
    setPanOffset(
      clampPanOffset(
        {
          x: panState.startPanX - (event.clientX - panState.pointerX) / scale,
          y: panState.startPanY - (event.clientY - panState.pointerY) / scale
        },
        layoutWidth,
        layoutHeight,
        viewWidth,
        viewHeight
      )
    );
  };

  const panFromWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    const scale = getSvgScreenScale(canvasSize, viewWidth, viewHeight);
    if (scale === 0) return;
    setPanOffset((offset) =>
      clampPanOffset(
        {
          x: offset.x + event.deltaX / scale,
          y: offset.y + event.deltaY / scale
        },
        layoutWidth,
        layoutHeight,
        viewWidth,
        viewHeight
      )
    );
  };

  const startSelectedGroupDrag = (event: React.PointerEvent<SVGElement>) => {
    if (panMode || event.button !== 0 || selectedPlacedIds.length === 0) return;
    event.stopPropagation();
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    const local = getSvgPoint(svg, event);
    const dragIds = [...selectedPlacedIds];
    const origins = Object.fromEntries(
      placed
        .filter((item) => dragIds.includes(item.id))
        .map((item) => [item.id, { x: item.x, y: item.y }])
    );

    interactionSnapshotRef.current = createSnapshot();
    setMarquee(null);
    setPanning(null);
    setRotating(null);
    setDragging({
      ids: dragIds,
      offsetX: 0,
      offsetY: 0,
      startX: local.x,
      startY: local.y,
      origins
    });
  };

  const startRotateHandle = (
    event: React.PointerEvent<SVGElement>,
    rotateIds: string[],
    bounds: Rect
  ) => {
    if (panMode) return;
    event.stopPropagation();
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const local = getSvgPoint(svg, event);
    const origins = Object.fromEntries(
      placed
        .filter((placedItem) => rotateIds.includes(placedItem.id))
        .map((placedItem) => [
          placedItem.id,
          {
            x: placedItem.x,
            y: placedItem.y,
            rotation: placedItem.rotation
          }
        ])
    );
    const pivotX = bounds.x + bounds.width / 2;
    const pivotY = bounds.y + bounds.height / 2;
    interactionSnapshotRef.current = createSnapshot();
    setSelectedPlacedIds(rotateIds);
    setDragging(null);
    setMarquee(null);
    setPanning(null);
    setRotating({
      ids: rotateIds,
      pivotX,
      pivotY,
      startAngle: angleBetween(pivotX, pivotY, local.x, local.y),
      origins,
      pointerX: event.clientX,
      pointerY: event.clientY,
      displayAngle: 0
    });
  };

  const updateRotation = (
    event: React.PointerEvent<SVGSVGElement>,
    rotateState: RotateState
  ) => {
    const local = getSvgPoint(event.currentTarget, event);
    const currentAngle = angleBetween(
      rotateState.pivotX,
      rotateState.pivotY,
      local.x,
      local.y
    );
    const delta = currentAngle - rotateState.startAngle;
    setRotating({
      ...rotateState,
      pointerX: event.clientX,
      pointerY: event.clientY,
      displayAngle: normalizeDisplayAngle(Math.round(delta))
    });
    setPlaced((items) =>
      items.map((item) =>
        !rotateState.ids.includes(item.id)
          ? item
          : (() => {
              const origin = rotateState.origins[item.id];
              if (!origin) return item;
              const rotatedPosition = rotatePoint(
                origin.x - rotateState.pivotX,
                origin.y - rotateState.pivotY,
                delta
              );
              return {
                ...item,
                x: roundLayoutValue(rotatedPosition.x + rotateState.pivotX),
                y: roundLayoutValue(rotatedPosition.y + rotateState.pivotY),
                rotation: normalizeAngle(Math.round(origin.rotation + delta))
              };
            })()
      )
    );
  };

  const updateMarquee = (
    event: React.PointerEvent<SVGSVGElement>,
    marqueeState: MarqueeState
  ) => {
    const local = getSvgPoint(event.currentTarget, event);
    setMarquee({
      ...marqueeState,
      currentX: local.x,
      currentY: local.y
    });
  };

  const finishMarquee = (marqueeState: MarqueeState) => {
    const selectionRect = normalizeRect(marqueeState);
    if (selectionRect.width < 4 && selectionRect.height < 4) {
      setSelectedPlacedIds([]);
      setMarquee(null);
      return;
    }

    const selectedIds = placed
      .filter((item) => {
        const track = trackMap.get(item.trackId);
        if (!track) return false;
        return rectsIntersect(getPlacedTrackBounds(item, track), selectionRect);
      })
      .map((item) => item.id);

    setSelectedPlacedIds(selectedIds);
    setMarquee(null);
  };

  const finishPointerInteraction = () => {
    if (dragging || rotating) {
      commitHistoryFrom(interactionSnapshotRef.current);
    }
    interactionSnapshotRef.current = null;
    setDragging(null);
    setPanning(null);
    setRotating(null);
  };

  const updateTrainPlacement = (event: React.PointerEvent<SVGSVGElement>) => {
    if (trainRoute.totalLength <= 0) return;
    const point = getSvgPoint(event.currentTarget, event);
    setTrainDistance(getClosestRouteDistance(trainRoute, point));
  };

  const startTrainPlacement = (event: React.PointerEvent<SVGGElement>) => {
    if (panMode) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg || trainRoute.totalLength <= 0) return;
    setTrainRunning(false);
    setPlacingTrain(true);
    setTrainDistance(getClosestRouteDistance(trainRoute, getSvgPoint(svg, event)));
  };

  return (
    <main className={`app-shell ${viewMode === "3d" ? "app-shell-3d" : ""}`}>
      {mobilePanel ? (
        <button
          className="mobile-sheet-backdrop"
          type="button"
          onClick={() => setMobilePanel(null)}
          aria-label="關閉面板"
        />
      ) : null}

      {viewMode === "2d" ? <aside className={`sidebar mobile-sheet ${mobilePanel === "library" ? "is-open" : ""}`}>
        <div className="mobile-sheet-header">
          <span className="mobile-sheet-handle" aria-hidden="true" />
          <div>
            <CircleDot size={18} />
            <strong>軌道庫</strong>
          </div>
          <button type="button" onClick={() => setMobilePanel(null)} aria-label="關閉軌道庫">
            <ChevronDown size={20} />
          </button>
        </div>
        <section className="panel track-panel">
          <div className="panel-title">
            <CircleDot size={17} />
            <span>Tomix 軌道</span>
          </div>

          <div className="library-tabs" aria-label="Library mode">
            <button
              className={libraryMode === "tracks" ? "active" : ""}
              onClick={() => setLibraryMode("tracks")}
            >
              單品
            </button>
            <button
              className={libraryMode === "sets" ? "active" : ""}
              onClick={() => setLibraryMode("sets")}
            >
              整組
            </button>
          </div>

          {libraryMode === "tracks" ? (
            <>
              <div className="kind-tabs" aria-label="Track categories">
                {kindOrder.map((kind) => (
                  <button
                    key={kind}
                    className={activeKind === kind ? "active" : ""}
                    onClick={() => setActiveKind(kind)}
                  >
                    {kindLabels[kind]}
                  </button>
                ))}
              </div>

              <div className="track-list">
                {TOMIX_TRACKS.filter((track) => track.kind === activeKind).map(
                  (track) => (
                    <button
                      key={track.id}
                      className={`track-option ${
                        selectedTrackId === track.id ? "selected" : ""
                      }`}
                      draggable
                      onClick={() => setSelectedTrackId(track.id)}
                      onDoubleClick={() => addTrack(track)}
                      onDragStart={(event) => startTrackDrag(event, track)}
                      title="拖曳到畫布即可新增軌道"
                    >
                      <span className="mini-track" aria-hidden="true">
                        <svg viewBox="-80 -80 160 160">
                          <TrackGhost track={track} />
                        </svg>
                      </span>
                      <span>
                        <strong>{track.code}</strong>
                        <small>{track.name}</small>
                      </span>
                      <ChevronDown size={15} />
                    </button>
                  )
                )}
              </div>
            </>
          ) : (
            <div className="set-list">
              {TOMIX_TRACK_SETS.map((set) => (
              <button
                key={set.id}
                className={`set-option set-${set.color} ${
                  selectedSetId === set.id ? "selected" : ""
                }`}
                onClick={() => setSelectedSetId(set.id)}
                onDoubleClick={() => addSet(set)}
              >
                <span className="set-badge">{set.pattern}</span>
                <span className="set-copy">
                  <strong>{set.code}</strong>
                  <small>
                    {set.layoutSize.height} x {set.layoutSize.width} mm
                  </small>
                  <em>{summarizeSet(set)}</em>
                </span>
              </button>
              ))}
            </div>
          )}
        </section>

        <button
          className="add-button"
          onClick={() => {
            if (libraryMode === "sets") addSet();
            else addTrack();
            setMobilePanel(null);
          }}
        >
          <Plus size={18} />
          {libraryMode === "sets" ? "新增選取整組" : "新增選取軌道"}
        </button>
      </aside> : null}

      <section className={`workspace workspace-${viewMode}`}>
        <header className={`topbar topbar-${viewMode}`}>
          <div className="workspace-heading">
            <div>
              <p className="eyebrow">{viewMode === "2d" ? "2D playground" : "3D layout view"}</p>
              <h2>
                {layoutWidth} x {layoutHeight} mm
              </h2>
            </div>
          </div>
          <div className="tool-strip">
            <div className="toolbar-group toolbar-view-group">
              <div className="view-mode-control" aria-label="檢視模式">
                <button
                  className={viewMode === "2d" ? "active" : ""}
                  onClick={() => setViewMode("2d")}
                  aria-pressed={viewMode === "2d"}
                  title="2D 檢視"
                >
                  <Grid2X2 size={16} />
                  <span>2D</span>
                </button>
                <button
                  className={viewMode === "3d" ? "active" : ""}
                  onClick={() => setViewMode("3d")}
                  aria-pressed={viewMode === "3d"}
                  title="3D 檢視"
                >
                  <Box size={16} />
                  <span>3D</span>
                </button>
              </div>
            </div>
            {viewMode === "2d" ? (
              <div className="toolbar-group toolbar-zoom-group" role="group" aria-label="畫布縮放">
                <button
                  className="toolbar-icon-button"
                  type="button"
                  onClick={() => changeZoom(zoom - 0.05)}
                  disabled={zoom <= 0.5}
                  aria-label="縮小畫布"
                  title="縮小"
                >
                  <ZoomOut size={17} />
                </button>
                <output className="topbar-zoom-value" aria-label="目前縮放比例">
                  {Math.round(zoom * 100)}%
                </output>
                <button
                  className="toolbar-icon-button"
                  type="button"
                  onClick={() => changeZoom(zoom + 0.05)}
                  disabled={zoom >= 3}
                  aria-label="放大畫布"
                  title="放大"
                >
                  <ZoomIn size={17} />
                </button>
              </div>
            ) : null}
            {viewMode === "3d" ? (
              <div className="toolbar-group">
                <button
                  className={`toolbar-icon-button ${nightMode ? "active-tool" : ""}`}
                  type="button"
                  onClick={() => setNightMode((enabled) => !enabled)}
                  aria-pressed={nightMode}
                  aria-label={nightMode ? "切換為日間模式" : "切換為夜間模式"}
                  title={nightMode ? "切換為日間模式" : "切換為夜間模式"}
                >
                  {nightMode ? <Moon size={17} /> : <Sun size={17} />}
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <div
          className={`canvas-frame ${viewMode === "3d" ? "canvas-frame-3d" : ""}`}
          ref={canvasFrameRef}
        >
          {viewMode === "3d" ? (
            <Layout3DView
              layoutWidth={layoutWidth}
              layoutHeight={layoutHeight}
              tracks={trackPolylines}
              turnouts={turnoutIndicators}
              trainRoute={trainRoute}
              trainDistance={trainTravelDistance}
              trainReversed={trainDirection === -1}
              showTurnoutLabels={showTurnoutLabels}
              showTrain={showTrain}
              nightMode={nightMode}
            />
          ) : (
            <>
          <svg
            className={`layout-canvas ${panMode || panning ? "is-panning" : ""}`}
            viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`}
            onPointerDown={startMarquee}
            onContextMenu={(event) => event.preventDefault()}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDrop={dropTrackOnCanvas}
            onPointerMove={(event) => {
              if (placingTrain) updateTrainPlacement(event);
              if (rotating) updateRotation(event, rotating);
              if (panning) updatePan(event, panning);
              if (dragging) updateDraggedTrack(event, dragging);
              if (marquee) updateMarquee(event, marquee);
            }}
            onWheel={(event) => {
              event.preventDefault();
              if (event.ctrlKey || event.metaKey) {
                changeZoom(zoom + (event.deltaY > 0 ? -0.05 : 0.05));
                return;
              }
              panFromWheel(event);
            }}
            onPointerUp={() => {
              if (marquee) finishMarquee(marquee);
              setPlacingTrain(false);
              finishPointerInteraction();
            }}
            onPointerLeave={() => {
              finishPointerInteraction();
              setPlacingTrain(false);
              setMarquee(null);
            }}
          >
            <defs>
              <pattern
                id="majorGrid"
                width="70"
                height="70"
                patternUnits="userSpaceOnUse"
              >
                <path d="M 70 0 L 0 0 0 70" className="grid-major" />
              </pattern>
              <pattern
                id="minorGrid"
                width="10"
                height="10"
                patternUnits="userSpaceOnUse"
              >
                <path d="M 10 0 L 0 0 0 10" className="grid-minor" />
              </pattern>
            </defs>
            <rect
              x={0}
              y={0}
              width={layoutWidth}
              height={layoutHeight}
              className="table-surface"
            />
            <rect
              x={0}
              y={0}
              width={layoutWidth}
              height={layoutHeight}
              fill="url(#minorGrid)"
            />
            <rect
              x={0}
              y={0}
              width={layoutWidth}
              height={layoutHeight}
              fill="url(#majorGrid)"
            />

            {placed.map((item) => {
              const track = trackMap.get(item.trackId);
              if (!track) return null;
              const pivot = getTrackPivot(track);
              const isSelected = selectedPlacedIds.includes(item.id);
              return (
                <g
                  key={item.id}
                  transform={`translate(${item.x} ${item.y}) rotate(${item.rotation}) translate(${-pivot.x} ${-pivot.y})`}
                  className={`placed-track ${isSelected ? "active" : ""}`}
                  onPointerDown={(event) => {
                    if (panMode) return;
                    event.stopPropagation();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    const svg = event.currentTarget.ownerSVGElement;
                    if (svg) {
                      const local = getSvgPoint(svg, event);
                      const dragIds = isSelected ? selectedPlacedIds : [item.id];
                      if (event.altKey) {
                        const copiedTracks = placed
                          .filter((placedItem) => dragIds.includes(placedItem.id))
                          .map((placedItem) => ({
                            ...placedItem,
                            id: `${placedItem.trackId}-${createUniqueId()}`
                          }));
                        const copiedIds = copiedTracks.map((copiedTrack) => copiedTrack.id);
                        const origins = Object.fromEntries(
                          copiedTracks.map((copiedTrack) => [
                            copiedTrack.id,
                            { x: copiedTrack.x, y: copiedTrack.y }
                          ])
                        );

                        interactionSnapshotRef.current = createSnapshot();
                        setPlaced((items) => [...items, ...copiedTracks]);
                        setSelectedPlacedIds(copiedIds);
                        setDragging({
                          ids: copiedIds,
                          offsetX: local.x - item.x,
                          offsetY: local.y - item.y,
                          startX: local.x,
                          startY: local.y,
                          origins
                        });
                        return;
                      }
                      const origins = Object.fromEntries(
                        placed
                          .filter((placedItem) => dragIds.includes(placedItem.id))
                          .map((placedItem) => [
                            placedItem.id,
                            { x: placedItem.x, y: placedItem.y }
                          ])
                      );
                      interactionSnapshotRef.current = createSnapshot();
                      setDragging({
                        ids: dragIds,
                        offsetX: local.x - item.x,
                        offsetY: local.y - item.y,
                        startX: local.x,
                        startY: local.y,
                        origins
                      });
                    }
                    if (!isSelected) {
                      setSelectedPlacedIds([item.id]);
                    }
                  }}
                >
                  <TrackShape track={track} labelRotation={item.rotation} />
                </g>
              );
            })}
            {showTrain ? (
              <SimulatedTrain
                route={trainRoute}
                distance={trainTravelDistance}
                reversed={trainDirection === -1}
                onPointerDown={startTrainPlacement}
              />
            ) : null}
            {selectedBounds ? (
              <AxisAlignedSelectionFrame
                bounds={selectedBounds}
                onDragPointerDown={startSelectedGroupDrag}
                onRotatePointerDown={(event) =>
                  startRotateHandle(event, selectedPlacedIds, selectedBounds)
                }
              />
            ) : null}
            {marquee ? (
              <rect
                className="marquee-selection"
                x={normalizeRect(marquee).x}
                y={normalizeRect(marquee).y}
                width={normalizeRect(marquee).width}
                height={normalizeRect(marquee).height}
              />
            ) : null}
          </svg>

          <CanvasRulers
            canvasSize={canvasSize}
            viewX={viewX}
            viewY={viewY}
            viewWidth={viewWidth}
            viewHeight={viewHeight}
          />

          <div className="canvas-mode-hint" role="status" aria-live="polite">
            {panMode ? <Hand size={18} /> : <MousePointer2 size={18} />}
            <span>
              <strong>{panMode ? "拖移畫布" : "選取模式"}</strong>
              <small>
                {panMode
                  ? "拖曳任意位置移動畫布，軌道不會被選取"
                  : "點選軌道可移動、旋轉或刪除"}
              </small>
            </span>
          </div>

          <div className="canvas-view-controls" role="group" aria-label="畫布檢視控制">
            <div className="canvas-mode-control" role="radiogroup" aria-label="畫布操作模式">
              <button
                type="button"
                role="radio"
                className={!panMode ? "active" : ""}
                onClick={() => setPanMode(false)}
                aria-checked={!panMode}
                aria-label="選取軌道"
                title="選取軌道"
              >
                <MousePointer2 size={19} />
              </button>
              <button
                type="button"
                role="radio"
                className={panMode ? "active" : ""}
                onClick={() => setPanMode(true)}
                aria-checked={panMode}
                aria-label="拖移畫布"
                title="拖移畫布"
              >
                <Hand size={19} />
              </button>
            </div>
            <button
              type="button"
              className="canvas-reset-action"
              onClick={resetView}
              onPointerUp={(event) => event.currentTarget.blur()}
              aria-label="重設視角"
              title="重設視角"
            >
              <Crosshair size={18} />
            </button>
            <span className="canvas-view-divider" aria-hidden="true" />
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo}
              aria-label="復原"
              title="復原"
            >
              <Undo2 size={18} />
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              aria-label="重做"
              title="重做"
            >
              <Redo2 size={18} />
            </button>
          </div>
            </>
          )}

          {rotating ? (
            <div
              className="rotation-angle-tooltip"
              style={getPointerOverlayStyle(
                rotating.pointerX,
                rotating.pointerY,
                canvasFrameRef.current
              )}
            >
              {rotating.displayAngle}°
            </div>
          ) : null}

          {placed.length === 0 ? (
            <div className="empty-state">
              <Grid2X2 size={21} />
              <span className="desktop-empty-instruction">
                從左側新增 Tomix 軌道，或雙擊軌道清單直接放入畫布。
              </span>
              <span className="mobile-empty-instruction">
                點下方「軌道」選擇型號，再按「新增」放入畫布。
              </span>
            </div>
          ) : null}
        </div>
      </section>

      <aside className={`inspector mobile-sheet ${mobilePanel === "inspector" ? "is-open" : ""}`}>
        <div className="mobile-sheet-header">
          <span className="mobile-sheet-handle" aria-hidden="true" />
          <div>
            <Move size={18} />
            <strong>配置控制</strong>
          </div>
          <button type="button" onClick={() => setMobilePanel(null)} aria-label="關閉配置控制">
            <ChevronDown size={20} />
          </button>
        </div>
        <section className="panel">
          <div className="panel-title">
            <Grid2X2 size={17} />
            <span>場地尺寸</span>
          </div>
          <div className="dimension-grid">
            <label>
              <span>寬 mm</span>
              <input
                type="number"
                min={300}
                step={10}
                value={layoutWidth}
                onChange={(event) => setLayoutWidth(Number(event.target.value))}
              />
            </label>
            <label>
              <span>高 mm</span>
              <input
                type="number"
                min={300}
                step={10}
                value={layoutHeight}
                onChange={(event) => setLayoutHeight(Number(event.target.value))}
              />
            </label>
          </div>
          <div className="layout-file-actions">
            <button type="button" onClick={exportLayoutFile} title="下載目前配置專案檔">
              <Upload size={15} />
              匯出配置
            </button>
            <button
              type="button"
              onClick={() => layoutFileInputRef.current?.click()}
              title="從專案檔匯入配置"
            >
              <Download size={15} />
              匯入配置
            </button>
            <input
              ref={layoutFileInputRef}
              className="layout-file-input"
              type="file"
              accept="application/json,.json"
              onChange={importLayoutFile}
              aria-label="匯入 Tomix 配置檔"
            />
          </div>
          {layoutFileStatus !== "idle" ? (
            <p className={`layout-file-status ${layoutFileStatus}`} role="status">
              {layoutFileStatus === "exported"
                ? "配置檔已下載"
                : layoutFileStatus === "imported"
                  ? "配置已匯入"
                  : "無法讀取此配置檔"}
            </p>
          ) : null}
        </section>

        <section className="panel train-inspector-panel" aria-label="列車控制">
          <div className="panel-title">
            <Play size={17} />
            <span>列車控制</span>
          </div>
          <div className="train-control">
            <button
              className={trainRunning ? "active-tool" : ""}
              onClick={() => {
                setShowTrain(true);
                if (trainRunning) {
                  setTrainRunning(false);
                  setTrainStopReason("使用者手動暫停");
                  appendTrainDebugEvent(
                    "train paused",
                    `manual pause at=${formatTrainPose(sampleTrainRoute(trainRoute, trainDistance))}`
                  );
                } else {
                  terminalStopReportedRef.current = false;
                  setTrainStopReason("行駛中");
                  setTrainRunning(true);
                  appendTrainDebugEvent(
                    "train started",
                    `speed=${trainSpeed} mm/s; direction=${trainDirection === 1 ? "right" : "left"}; at=${formatTrainPose(sampleTrainRoute(trainRoute, trainDistance))}`
                  );
                }
              }}
              disabled={trainRoute.totalLength <= 0}
              aria-label={trainRunning ? "暫停列車" : "啟動列車"}
            >
              {trainRunning ? <Pause size={16} /> : <Play size={16} />}
              {trainRunning ? "暫停" : "行駛"}
            </button>
            <button
              className={showTrain ? "active-tool" : ""}
              onClick={() => setShowTrain((visible) => !visible)}
              aria-label={showTrain ? "隱藏列車" : "顯示列車"}
              aria-pressed={showTrain}
              title={showTrain ? "隱藏列車" : "顯示列車"}
            >
              {showTrain ? <Eye size={16} /> : <EyeOff size={16} />}
              {showTrain ? "列車" : "已隱藏"}
            </button>
            <select
              value={trainSpeed}
              onChange={(event) => {
                const speed = Number(event.target.value);
                setTrainSpeed(speed);
                appendTrainDebugEvent("speed changed", `${speed} mm/s`);
              }}
              aria-label="列車速度"
            >
              <option value={80}>慢速</option>
              <option value={160}>標準</option>
              <option value={320}>快速</option>
              <option value={640}>超快速</option>
              <option value={1280}>超急速</option>
            </select>
            <div className="train-direction-control" role="group" aria-label="列車行駛方向">
              <button
                className={trainDirection === -1 ? "active" : ""}
                type="button"
                onClick={() => changeTrainDirection(-1)}
                aria-pressed={trainDirection === -1}
                title="向左行駛"
              >
                <ArrowLeft size={15} />
                向左
              </button>
              <button
                className={trainDirection === 1 ? "active" : ""}
                type="button"
                onClick={() => changeTrainDirection(1)}
                aria-pressed={trainDirection === 1}
                title="向右行駛"
              >
                向右
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
          <p className="train-route-status">
            {trainRoute.segmentCount > 0
              ? `${trainRoute.segmentCount} 軌 · ${trainRoute.closed ? "環線" : "終點停車"}`
              : "尚無可行駛路線"}
          </p>
          <details className="train-debug-panel">
            <summary>Debug log</summary>
            <div className="train-debug-actions">
              <button
                className={`train-debug-copy ${trainDebugCopyState}`}
                type="button"
                onClick={copyTrainDebugReport}
                title="複製完整 Debug log"
              >
                {trainDebugCopyState === "copied" ? <Check size={14} /> : <Copy size={14} />}
                {trainDebugCopyState === "copied"
                  ? "已複製"
                  : trainDebugCopyState === "failed"
                    ? "複製失敗"
                    : "複製 log"}
              </button>
            </div>
            <textarea readOnly value={trainDebugReport} aria-label="列車模擬 Debug log" />
          </details>
        </section>

        {viewMode === "3d" && turnoutIndicators.length > 0 ? (
          <section className="panel turnout-inspector-panel">
            <div className="panel-title">
              <GitFork size={17} />
              <span>Point controller</span>
              <small>{turnoutIndicators.length}</small>
            </div>
            <label className="point-label-switch">
              <input
                type="checkbox"
                checked={showTurnoutLabels}
                onChange={(event) => setShowTurnoutLabels(event.target.checked)}
              />
              <span aria-hidden="true" />
              顯示 Point 編號
            </label>
            <div className="turnout-controller-list">
              {turnoutIndicators.map((turnout, index) => (
                <div className="turnout-controller-row" key={turnout.id}>
                  <div>
                    <small>#{index + 1}</small>
                    <strong>{turnout.code}</strong>
                  </div>
                  <div className="turnout-route-toggle" role="group" aria-label={`${turnout.code} 路徑`}>
                    <button
                      className={turnout.route === "main" ? "active" : ""}
                      type="button"
                      onClick={() => setTurnoutRoute(turnout.id, "main")}
                      aria-pressed={turnout.route === "main"}
                    >
                      直線
                    </button>
                    <button
                      className={turnout.route === "branch" ? "active" : ""}
                      type="button"
                      onClick={() => setTurnoutRoute(turnout.id, "branch")}
                      aria-pressed={turnout.route === "branch"}
                    >
                      分歧
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="panel">
          <div className="panel-title">
            <Move size={17} />
            <span>選取資訊</span>
          </div>
          {selectedPlacedIds.length > 0 ? (
            <div className="selection-actions" aria-label="選取軌道操作">
              <button type="button" onClick={() => rotateSelected(-1)}>
                <RotateCcw size={16} />
                逆時針 1°
              </button>
              <button type="button" onClick={() => rotateSelected(1)}>
                <RotateCw size={16} />
                順時針 1°
              </button>
              <button type="button" className="selection-delete" onClick={removeSelected}>
                <Trash2 size={16} />
                刪除
              </button>
            </div>
          ) : null}
          {selectedPlacedIds.length > 1 ? (
            <div className="stats selection-stats">
              <dl>
                <dt>數量</dt>
                <dd>{selectedPlacedIds.length} 段軌道</dd>
                <dt>操作</dt>
                <dd>可一起旋轉或刪除</dd>
              </dl>
              <div className="selected-track-details">
                <p>已選軌道</p>
                <ol>
                  {visibleSelectedTrackDetails.map((track) => (
                    <li key={track.id}>
                      <strong>{track.code}</strong>
                    </li>
                  ))}
                </ol>
                {selectedTrackDetails.length > 10 ? (
                  <button
                    className="selection-more-button"
                    type="button"
                    onClick={() => setSelectionDetailsExpanded((expanded) => !expanded)}
                    aria-expanded={selectionDetailsExpanded}
                  >
                    {selectionDetailsExpanded
                      ? "收合"
                      : `More +${selectedTrackDetails.length - 10}`}
                    <ChevronDown size={15} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>
          ) : selectedPlaced && selectedPlacedDef ? (
            <div className="stats">
              <dl>
                <dt>型號</dt>
                <dd>{selectedPlacedDef.code}</dd>
                <dt>分類</dt>
                <dd>{kindLabels[selectedPlacedDef.kind]}</dd>
                <dt>X / Y</dt>
                <dd>
                  {selectedPlaced.x} / {selectedPlaced.y} mm
                </dd>
                <dt>角度</dt>
                <dd>{selectedPlaced.rotation}°</dd>
                <dt>幾何</dt>
                <dd>{describeGeometry(selectedPlacedDef)}</dd>
              </dl>
            </div>
          ) : (
            <p className="muted">點選軌道，或在空白處按住左鍵拖出矩形框選多段軌道。</p>
          )}
        </section>

      </aside>

      <nav className="mobile-dock" aria-label="Mobile workspace navigation">
        <button
          type="button"
          className={mobilePanel === "library" ? "active" : ""}
          onClick={() => setMobilePanel((panel) => panel === "library" ? null : "library")}
          aria-pressed={mobilePanel === "library"}
          disabled={viewMode === "3d"}
        >
          <CircleDot size={20} />
          <span>軌道</span>
        </button>
        <button
          type="button"
          className={mobilePanel === null ? "active" : ""}
          onClick={() => setMobilePanel(null)}
          aria-pressed={mobilePanel === null}
        >
          <Grid2X2 size={20} />
          <span>畫布</span>
        </button>
        <button
          type="button"
          className={mobilePanel === "inspector" ? "active" : ""}
          onClick={() => setMobilePanel((panel) => panel === "inspector" ? null : "inspector")}
          aria-pressed={mobilePanel === "inspector"}
        >
          <Move size={20} />
          <span>控制</span>
        </button>
      </nav>
    </main>
  );
}

function describeGeometry(track: TrackDefinition) {
  if (track.kind === "straight") return `${track.length} mm`;
  if (track.kind === "curve") return `R${track.radius} / ${track.angle}°`;
  if (track.kind === "turnout") return `${track.length} mm / ${track.branchAngle}°`;
  return track.note;
}

function readStoredLayout(
  rawLayout: string | null,
  trackMap: Map<string, TrackDefinition>
): LayoutSnapshot | null {
  if (!rawLayout) return null;

  try {
    const value = JSON.parse(rawLayout) as Partial<LayoutSnapshot>;
    if (
      !isPositiveNumber(value.layoutWidth) ||
      !isPositiveNumber(value.layoutHeight) ||
      !isPositiveNumber(value.zoom) ||
      !isPosition(value.panOffset) ||
      !Array.isArray(value.placed)
    ) {
      return null;
    }

    const placed = value.placed.filter(
      (item): item is PlacedTrack =>
        isPlacedTrack(item) && trackMap.has(item.trackId)
    );
    const placedIds = new Set(placed.map((item) => item.id));
    const selectedPlacedIds = Array.isArray(value.selectedPlacedIds)
      ? value.selectedPlacedIds.filter(
          (id): id is string => typeof id === "string" && placedIds.has(id)
        )
      : [];

    return {
      layoutWidth: value.layoutWidth,
      layoutHeight: value.layoutHeight,
      zoom: value.zoom,
      panOffset: value.panOffset,
      placed,
      selectedPlacedIds
    };
  } catch {
    return null;
  }
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isPosition(value: unknown): value is { x: number; y: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "x" in value &&
    "y" in value &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y)
  );
}

function isPlacedTrack(value: unknown): value is PlacedTrack {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "trackId" in value &&
    "x" in value &&
    "y" in value &&
    "rotation" in value &&
    typeof value.id === "string" &&
    typeof value.trackId === "string" &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y) &&
    typeof value.rotation === "number" &&
    Number.isFinite(value.rotation) &&
    (!("turnoutRoute" in value) ||
      value.turnoutRoute === undefined ||
      value.turnoutRoute === "main" ||
      value.turnoutRoute === "branch")
  );
}

function getViewOrigin(
  layoutWidth: number,
  layoutHeight: number,
  viewWidth: number,
  viewHeight: number
) {
  return {
    x: layoutWidth / 2 - viewWidth / 2,
    y: layoutHeight / 2 - viewHeight / 2
  };
}

function clampPanOffset(
  offset: { x: number; y: number },
  layoutWidth: number,
  layoutHeight: number,
  viewWidth: number,
  viewHeight: number
) {
  const origin = getViewOrigin(layoutWidth, layoutHeight, viewWidth, viewHeight);
  return {
    x: Math.max(-origin.x - horizontalAxisLeadingPadding, offset.x),
    y: Math.max(-origin.y, offset.y)
  };
}

function getTrackPivot(track: TrackDefinition) {
  if (track.kind === "curve") {
    if (track.id === "C541-15" || track.id === "C541PC-15") {
      const radians = (track.angle / 2) * (Math.PI / 180);
      return {
        x: Math.round(Math.sin(radians) * track.radius),
        y: Math.round(-track.radius + Math.cos(radians) * track.radius)
      };
    }

    const radians = (track.angle / 2) * (Math.PI / 180);
    return {
      x: Math.round(Math.cos(radians) * track.radius),
      y: Math.round(Math.sin(radians) * track.radius)
    };
  }

  if (track.kind === "turnout") {
    return { x: Math.round(track.length / 2), y: 0 };
  }

  return { x: Math.round(track.length / 2), y: 0 };
}

function snapDraggedTracks(
  items: PlacedTrack[],
  draggedIds: string[],
  trackMap: Map<string, TrackDefinition>
) {
  if (draggedIds.length === 0) return items;

  const dragged = new Set(draggedIds);
  const movingEndpoints: WorldTrackEndpoint[] = [];
  const targetEndpoints: WorldTrackEndpoint[] = [];

  for (const item of items) {
    const track = trackMap.get(item.trackId);
    if (!track) continue;

    const endpoints = getPlacedTrackEndpoints(item, track);
    if (dragged.has(item.id)) {
      movingEndpoints.push(...endpoints);
    } else {
      targetEndpoints.push(...endpoints);
    }
  }

  if (movingEndpoints.length === 0 || targetEndpoints.length === 0) return items;

  let match:
    | {
        moving: WorldTrackEndpoint;
        target: WorldTrackEndpoint;
        distance: number;
        rotationDelta: number;
        score: number;
      }
    | undefined;

  for (const moving of movingEndpoints) {
    for (const target of targetEndpoints) {
      const distance = Math.hypot(target.x - moving.x, target.y - moving.y);
      const rotationDelta = normalizeDisplayAngle(target.angle + 180 - moving.angle);
      if (distance > snapDistanceMm || Math.abs(rotationDelta) > 60) continue;

      const score = distance + Math.abs(rotationDelta) * 0.75;
      if (match && score >= match.score) continue;
      match = { moving, target, distance, rotationDelta, score };
    }
  }

  if (!match) return items;

  const rotationDelta = match.rotationDelta;

  return items.map((item) => {
    if (!dragged.has(item.id)) return item;

    const rotatedPosition = rotatePoint(
      item.x - match.moving.x,
      item.y - match.moving.y,
      rotationDelta
    );

    return {
      ...item,
      x: roundLayoutValue(rotatedPosition.x + match.target.x),
      y: roundLayoutValue(rotatedPosition.y + match.target.y),
      rotation: normalizeAngle(item.rotation + rotationDelta)
    };
  });
}

function getPlacedTrackEndpoints(
  item: PlacedTrack,
  track: TrackDefinition
): WorldTrackEndpoint[] {
  const pivot = getTrackPivot(track);

  return getLocalTrackEndpoints(track).map((endpoint) => {
    const rotated = rotatePoint(endpoint.x - pivot.x, endpoint.y - pivot.y, item.rotation);
    return {
      itemId: item.id,
      x: item.x + rotated.x,
      y: item.y + rotated.y,
      angle: normalizeAngle(endpoint.angle + item.rotation)
    };
  });
}

function getLocalTrackEndpoints(track: TrackDefinition): TrackEndpoint[] {
  if (track.kind === "straight" || track.kind === "adapter") {
    return [
      { x: 0, y: 0, angle: 180 },
      { x: track.length, y: 0, angle: 0 }
    ];
  }

  if (track.kind === "curve") {
    if (isCompactC541Track(track)) {
      const end = compactCurvePoint(track.radius, track.angle, track.radius);
      return [
        { x: 0, y: 0, angle: 180 },
        { x: end.x, y: end.y, angle: -track.angle }
      ];
    }

    const end = curvePoint(track.radius, track.angle);
    return [
      { x: track.radius, y: 0, angle: -90 },
      { x: end.x, y: end.y, angle: track.angle + 90 }
    ];
  }

  if (track.id === "PL541-15" || track.id === "PR541-15") {
    const mirror = track.id === "PR541-15" ? -1 : 1;
    const branchEnd = compactCurvePoint(541, 15, 541);
    return [
      { x: 0, y: 0, angle: 180 },
      { x: track.length, y: 0, angle: 0 },
      { x: branchEnd.x, y: branchEnd.y * mirror, angle: -15 * mirror }
    ];
  }

  if (track.id === "N-CPL317/280-45" || track.id === "N-CPR317/280-45") {
    const mirror = track.id === "N-CPR317/280-45" ? -1 : 1;
    const outerEnd = compactCurvePoint(317, 45, 317);
    const innerStart = compactCurvePoint(280, 0, 317);
    const innerEnd = compactCurvePoint(280, 45, 317);
    return [
      { x: 0, y: 0, angle: 180 },
      { x: outerEnd.x, y: outerEnd.y * mirror, angle: -45 * mirror },
      { x: innerStart.x, y: innerStart.y * mirror, angle: 180 },
      { x: innerEnd.x, y: innerEnd.y * mirror, angle: -45 * mirror }
    ];
  }

  const branchEnd = curvePoint(track.branchLength, track.branchAngle);
  if (track.branchFrom === "end") {
    const branchStart = {
      x:
        track.length -
        Math.cos((Math.abs(track.branchAngle) * Math.PI) / 180) * track.branchLength,
      y: Math.sin((track.branchAngle * Math.PI) / 180) * track.branchLength
    };
    return [
      { x: 0, y: 0, angle: 180 },
      { x: track.length, y: 0, angle: 0 },
      {
        x: branchStart.x,
        y: branchStart.y,
        angle: track.branchAngle + 180
      }
    ];
  }

  return [
    { x: 0, y: 0, angle: 180 },
    { x: track.length, y: 0, angle: 0 },
    { x: branchEnd.x, y: branchEnd.y, angle: track.branchAngle }
  ];
}

function isCompactC541Track(track: TrackDefinition) {
  return track.kind === "curve" && (track.id === "C541-15" || track.id === "C541PC-15");
}

function curvePoint(radius: number, angle: number) {
  const radians = (angle * Math.PI) / 180;
  return {
    x: Math.cos(radians) * radius,
    y: Math.sin(radians) * radius
  };
}

function compactCurvePoint(radius: number, angle: number, centerRadius = radius) {
  const radians = (angle * Math.PI) / 180;
  return {
    x: Math.sin(radians) * radius,
    y: -centerRadius + Math.cos(radians) * radius
  };
}

function roundLayoutValue(value: number) {
  return Number(value.toFixed(3));
}

function getPlacedTrackBounds(item: PlacedTrack, track: TrackDefinition): Rect {
  const bounds = getTrackBounds(track);
  const pivot = getTrackPivot(track);
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x, y: bounds.y + bounds.height },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height }
  ].map((point) => {
    const rotated = rotatePoint(point.x - pivot.x, point.y - pivot.y, item.rotation);
    return {
      x: item.x + rotated.x,
      y: item.y + rotated.y
    };
  });

  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
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

function getSelectionBounds(
  items: PlacedTrack[],
  selectedIds: string[],
  trackMap: Map<string, TrackDefinition>
): Rect | null {
  if (selectedIds.length === 0) return null;

  const selected = new Set(selectedIds);
  const bounds = items.flatMap((item) => {
    if (!selected.has(item.id)) return [];
    const track = trackMap.get(item.trackId);
    return track ? [getPlacedTrackBounds(item, track)] : [];
  });

  if (bounds.length === 0) return null;

  const left = Math.min(...bounds.map((bound) => bound.x));
  const top = Math.min(...bounds.map((bound) => bound.y));
  const right = Math.max(...bounds.map((bound) => bound.x + bound.width));
  const bottom = Math.max(...bounds.map((bound) => bound.y + bound.height));

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

function rotatePoint(x: number, y: number, angle: number) {
  const radians = (angle * Math.PI) / 180;
  return {
    x: x * Math.cos(radians) - y * Math.sin(radians),
    y: x * Math.sin(radians) + y * Math.cos(radians)
  };
}

function angleBetween(originX: number, originY: number, x: number, y: number) {
  return (Math.atan2(y - originY, x - originX) * 180) / Math.PI;
}

function normalizeRect(rect: MarqueeState): Rect {
  const x = Math.min(rect.startX, rect.currentX);
  const y = Math.min(rect.startY, rect.currentY);
  return {
    x,
    y,
    width: Math.abs(rect.currentX - rect.startX),
    height: Math.abs(rect.currentY - rect.startY)
  };
}

function rectsIntersect(a: Rect, b: Rect) {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}

function getSvgScreenScale(
  canvasSize: { width: number; height: number },
  viewWidth: number,
  viewHeight: number
) {
  return Math.min(
    canvasSize.width / viewWidth || 0,
    canvasSize.height / viewHeight || 0
  );
}

function getSvgRenderMetrics(
  canvasSize: { width: number; height: number },
  viewWidth: number,
  viewHeight: number
) {
  const scale = getSvgScreenScale(canvasSize, viewWidth, viewHeight);
  return {
    scale,
    offsetX: (canvasSize.width - viewWidth * scale) / 2,
    offsetY: (canvasSize.height - viewHeight * scale) / 2
  };
}

function getRulerStep(scale: number, targetPixels: number) {
  const minimum = targetPixels / Math.max(scale, 0.001);
  const magnitude = 10 ** Math.floor(Math.log10(minimum));
  const multiplier = [1, 2, 5, 10].find(
    (candidate) => candidate * magnitude >= minimum
  );
  return (multiplier ?? 10) * magnitude;
}

function getRulerTicks(start: number, end: number, step: number) {
  const first = Math.floor(start / step) * step;
  const count = Math.ceil((end - first) / step) + 1;
  return Array.from({ length: Math.min(count, 800) }, (_, index) =>
    Number((first + index * step).toFixed(4))
  ).filter((value) => value >= start - step && value <= end + step);
}

function isMajorRulerTick(value: number, step: number) {
  const quotient = value / step;
  return Math.abs(quotient - Math.round(quotient)) < 0.0001;
}

function formatRulerValue(value: number) {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

function getPointerOverlayStyle(
  clientX: number,
  clientY: number,
  frame: HTMLDivElement | null
) {
  const rect = frame?.getBoundingClientRect();
  return {
    left: clientX - (rect?.left ?? 0) + 14,
    top: clientY - (rect?.top ?? 0) + 14
  };
}

function normalizeAngle(angle: number) {
  return ((angle % 360) + 360) % 360;
}

function normalizeDisplayAngle(angle: number) {
  const normalized = normalizeAngle(angle);
  return normalized > 180 ? normalized - 360 : normalized;
}

function summarizeSet(set: TrackSetDefinition) {
  const counts = set.pieces.reduce<Record<string, number>>((result, piece) => {
    result[piece.trackId] = (result[piece.trackId] ?? 0) + 1;
    return result;
  }, {});

  return Object.entries(counts)
    .map(([trackId, count]) => `${trackId} x${count}`)
    .slice(0, 5)
    .join(" / ");
}

function SimulatedTrain({
  route,
  distance,
  reversed,
  onPointerDown
}: {
  route: TrainRoute;
  distance: number;
  reversed: boolean;
  onPointerDown: (event: React.PointerEvent<SVGGElement>) => void;
}) {
  const offsets = route.totalLength >= TRAIN_CAR_CENTER_SPACING_MM
    ? [0, TRAIN_CAR_CENTER_SPACING_MM]
    : [0];
  const cars = offsets.map((offset) =>
    sampleTrainRoute(route, distance - (reversed ? -offset : offset), reversed)
  );
  if (!cars[0]) return null;

  const halfLength = TRAIN_CAR_LENGTH_MM / 2;
  const halfWidth = 12;
  const roofEquipment = [-28, 5, 31];

  return (
    <g
      className="simulated-train"
      aria-label="行駛中的列車"
      onPointerDown={onPointerDown}
    >
      {cars.map((pose, index) =>
        pose ? (
          <g
            key={index}
            transform={`translate(${pose.x} ${pose.y}) rotate(${pose.angle})`}
            className={index === 0 ? "train-car train-car-lead" : "train-car"}
          >
            <rect className="train-car-shadow" x={-halfLength} y={-halfWidth} width={TRAIN_CAR_LENGTH_MM} height={halfWidth * 2} rx={4} />
            <rect className="train-car-body" x={-halfLength} y={-halfWidth} width={TRAIN_CAR_LENGTH_MM} height={halfWidth * 2} rx={4} />
            <rect className="train-car-underframe" x={-halfLength + 5} y={-halfWidth + 2} width={TRAIN_CAR_LENGTH_MM - 10} height={5} rx={1.5} />
            <rect className="train-car-roof" x={-halfLength + 8} y={-8.5} width={TRAIN_CAR_LENGTH_MM - 19} height={17} rx={3} />
            <path className="train-car-roof-centerline" d={`M ${-halfLength + 12} 0 H ${halfLength - 13}`} />
            {roofEquipment.map((x) => (
              <rect key={x} className="train-car-roof-equipment" x={x - 7} y={-3.5} width={14} height={7} rx={1.2} />
            ))}
            <path className="train-car-stripe" d={`M ${-halfLength + 7} ${halfWidth - 3} H ${halfLength - 9}`} />
            {index === 0 ? (
              <>
                <path
                  className="train-e500-cab"
                  d={`M ${halfLength - 20} ${-halfWidth + 2} H ${halfLength - 4} L ${halfLength - 1} ${-halfWidth + 7} V ${halfWidth - 7} L ${halfLength - 4} ${halfWidth - 2} H ${halfLength - 20} Z`}
                />
                <path
                  className="train-e500-windscreen"
                  d={`M ${halfLength - 16} ${-halfWidth + 5} H ${halfLength - 5} L ${halfLength - 3} ${-halfWidth + 8} V ${halfWidth - 8} L ${halfLength - 5} ${halfWidth - 5} H ${halfLength - 16} Z`}
                />
                <circle className="train-e500-marker-light" cx={halfLength - 7} cy={-2.5} r={1.35} />
                <circle className="train-e500-marker-light" cx={halfLength - 7} cy={2.5} r={1.35} />
                <circle className="train-headlight" cx={halfLength - 4.5} cy={-7.1} r={1.7} />
                <circle className="train-headlight" cx={halfLength - 4.5} cy={7.1} r={1.7} />
                <text className="train-r-logo" x={halfLength - 14} y={2.7}>R</text>
                <text className="train-e500-mark" x={-halfLength + 12} y={3.5}>E500</text>
              </>
            ) : null}
          </g>
        ) : null
      )}
    </g>
  );
}

function AxisAlignedSelectionFrame({
  bounds,
  onDragPointerDown,
  onRotatePointerDown
}: {
  bounds: Rect;
  onDragPointerDown?: (event: React.PointerEvent<SVGElement>) => void;
  onRotatePointerDown?: (event: React.PointerEvent<SVGElement>) => void;
}) {
  const padding = 12;
  const x = bounds.x - padding;
  const y = bounds.y - padding;
  const width = bounds.width + padding * 2;
  const height = bounds.height + padding * 2;
  const centerX = x + width / 2;
  const bottomY = y + height;

  return (
    <g className="selection-frame">
      <rect
        className="selection-drag-area"
        x={x}
        y={y}
        width={width}
        height={height}
        rx={8}
        onPointerDown={onDragPointerDown}
      />
      <circle
        className="selection-rotate-corner"
        cx={x}
        cy={y}
        r={5}
        onPointerDown={onRotatePointerDown}
      />
      <circle
        className="selection-rotate-corner"
        cx={x + width}
        cy={y}
        r={5}
        onPointerDown={onRotatePointerDown}
      />
      <circle
        className="selection-rotate-corner"
        cx={x}
        cy={bottomY}
        r={5}
        onPointerDown={onRotatePointerDown}
      />
      <circle cx={centerX} cy={bottomY} r={5} />
      <circle
        className="selection-rotate-corner"
        cx={x + width}
        cy={bottomY}
        r={5}
        onPointerDown={onRotatePointerDown}
      />
      <g
        className="rotate-handle"
        transform={`translate(${centerX} ${y})`}
        onPointerDown={onRotatePointerDown}
      >
        <circle cx={0} cy={0} r={5} />
      </g>
    </g>
  );
}

function CanvasRulers({
  canvasSize,
  viewX,
  viewY,
  viewWidth,
  viewHeight
}: {
  canvasSize: { width: number; height: number };
  viewX: number;
  viewY: number;
  viewWidth: number;
  viewHeight: number;
}) {
  if (canvasSize.width === 0 || canvasSize.height === 0) return null;

  const metrics = getSvgRenderMetrics(canvasSize, viewWidth, viewHeight);
  const rulerSize = 22;
  const majorStep = getRulerStep(metrics.scale, 78);
  const minorStep = majorStep / 5;
  const horizontalTicks = getRulerTicks(viewX, viewX + viewWidth, minorStep);
  const verticalTicks = getRulerTicks(viewY, viewY + viewHeight, minorStep);

  return (
    <div className="canvas-rulers" aria-hidden="true">
      <svg
        className="canvas-ruler canvas-ruler-horizontal"
        viewBox={`0 0 ${canvasSize.width} ${rulerSize}`}
      >
        <rect width={canvasSize.width} height={rulerSize} />
        {horizontalTicks.map((value) => {
          const x = metrics.offsetX + (value - viewX) * metrics.scale;
          const major = isMajorRulerTick(value, majorStep);
          return (
            <g key={`x-${value}`} transform={`translate(${x} 0)`}>
              <line y1={major ? 2 : 11} y2={rulerSize} />
              {major && value >= 0 ? <text x={3} y={10}>{formatRulerValue(value)}</text> : null}
            </g>
          );
        })}
      </svg>
      <svg
        className="canvas-ruler canvas-ruler-vertical"
        viewBox={`0 0 ${rulerSize} ${canvasSize.height}`}
      >
        <rect width={rulerSize} height={canvasSize.height} />
        {verticalTicks.map((value) => {
          const y = metrics.offsetY + (value - viewY) * metrics.scale;
          const major = isMajorRulerTick(value, majorStep);
          return (
            <g key={`y-${value}`} transform={`translate(0 ${y})`}>
              <line x1={major ? 2 : 11} x2={rulerSize} />
              {major && value >= 0 ? (
                <text x={9} y={-3} transform="rotate(-90 9 -3)">
                  {formatRulerValue(value)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="canvas-ruler-corner">mm</div>
    </div>
  );
}

let fallbackIdSequence = 0;

function createUniqueId() {
  const browserCrypto = globalThis.crypto;

  if (typeof browserCrypto?.randomUUID === "function") {
    return browserCrypto.randomUUID();
  }

  if (typeof browserCrypto?.getRandomValues === "function") {
    const bytes = browserCrypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  }

  fallbackIdSequence += 1;
  return `${Date.now().toString(36)}-${fallbackIdSequence.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isEditableElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable
  );
}

function formatTrainPose(pose: TrainPose | null | undefined) {
  return pose
    ? `${pose.x.toFixed(1)},${pose.y.toFixed(1)} heading=${pose.angle.toFixed(1)}deg`
    : "unavailable";
}

function describeLayoutForDebug(
  placed: PlacedTrack[],
  trackMap: Map<string, TrackDefinition>
) {
  const counts = new Map<string, number>();
  const pointStates: string[] = [];

  for (const item of placed) {
    const track = trackMap.get(item.trackId);
    if (!track) continue;
    counts.set(track.code, (counts.get(track.code) ?? 0) + 1);
    if (track.kind === "turnout") {
      pointStates.push(
        `${track.code} (${item.id.slice(-5)})=${item.turnoutRoute === "branch" ? "branch" : "main"}`
      );
    }
  }

  const composition = [...counts.entries()]
    .map(([code, count]) => `${code}x${count}`)
    .join(", ");
  return `tracks=${placed.length}; composition=[${composition || "none"}]; points=[${pointStates.join(", ") || "none"}]`;
}

function snapshotsEqual(a: LayoutSnapshot, b: LayoutSnapshot) {
  if (
    a.layoutWidth !== b.layoutWidth ||
    a.layoutHeight !== b.layoutHeight ||
    a.zoom !== b.zoom ||
    a.panOffset.x !== b.panOffset.x ||
    a.panOffset.y !== b.panOffset.y ||
    a.placed.length !== b.placed.length
  ) {
    return false;
  }

  return a.placed.every((track, index) => {
    const other = b.placed[index];
    return (
      track.id === other.id &&
      track.trackId === other.trackId &&
      track.x === other.x &&
      track.y === other.y &&
      track.rotation === other.rotation &&
      track.turnoutRoute === other.turnoutRoute
    );
  });
}

function getSvgPoint(
  svg: SVGSVGElement,
  event: Pick<React.PointerEvent, "clientX" | "clientY">
) {
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  return point.matrixTransform(ctm.inverse());
}
