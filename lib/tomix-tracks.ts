export type TrackKind = "straight" | "curve" | "turnout" | "adapter";

type BaseTrack = {
  id: string;
  code: string;
  name: string;
  maker: "Tomix";
  kind: TrackKind;
  note?: string;
};

export type StraightTrack = BaseTrack & {
  kind: "straight";
  length: number;
};

export type CurveTrack = BaseTrack & {
  kind: "curve";
  radius: number;
  angle: number;
};

export type TurnoutTrack = BaseTrack & {
  kind: "turnout";
  length: number;
  branchLength: number;
  branchAngle: number;
  branchFrom?: "start" | "end";
};

export type AdapterTrack = BaseTrack & {
  kind: "adapter";
  length: number;
  note: string;
};

export type TrackDefinition =
  | StraightTrack
  | CurveTrack
  | TurnoutTrack
  | AdapterTrack;

export type TrackSetPiece = {
  trackId: string;
  x: number;
  y: number;
  rotation: number;
};

export type TrackSetDefinition = {
  id: string;
  code: string;
  name: string;
  pattern: "A" | "B" | "D" | "P";
  maker: "Tomix";
  layoutSize: {
    width: number;
    height: number;
  };
  color: "red" | "green" | "blue" | "black";
  note: string;
  pieces: TrackSetPiece[];
};

export const TOMIX_TRACKS: TrackDefinition[] = [
  {
    id: "S18.5",
    code: "S18.5",
    name: "Fine adjustment",
    maker: "Tomix",
    kind: "straight",
    length: 18.5
  },
  {
    id: "S33",
    code: "S33",
    name: "Fine adjustment",
    maker: "Tomix",
    kind: "straight",
    length: 33
  },
  {
    id: "S70",
    code: "S70",
    name: "Straight 70",
    maker: "Tomix",
    kind: "straight",
    length: 70
  },
  {
    id: "S140",
    code: "S140",
    name: "Straight 140",
    maker: "Tomix",
    kind: "straight",
    length: 140
  },
  {
    id: "S280",
    code: "S280",
    name: "Straight 280",
    maker: "Tomix",
    kind: "straight",
    length: 280
  },
  {
    id: "S280PC",
    code: "S280PC",
    name: "Straight 280 PC",
    maker: "Tomix",
    kind: "straight",
    length: 280
  },
  {
    id: "S140PC",
    code: "S140PC",
    name: "Straight 140 PC",
    maker: "Tomix",
    kind: "straight",
    length: 140
  },
  {
    id: "S140-RE",
    code: "S140-RE",
    name: "Rerailer straight",
    maker: "Tomix",
    kind: "straight",
    length: 140
  },
  {
    id: "S72.5",
    code: "S72.5",
    name: "Fine adjustment",
    maker: "Tomix",
    kind: "straight",
    length: 72.5
  },
  {
    id: "S72.5PC",
    code: "S72.5PC",
    name: "Straight 72.5 PC",
    maker: "Tomix",
    kind: "straight",
    length: 72.5
  },
  {
    id: "S99",
    code: "S99",
    name: "Fine adjustment",
    maker: "Tomix",
    kind: "straight",
    length: 99
  },
  {
    id: "S158.5",
    code: "S158.5",
    name: "Fine adjustment",
    maker: "Tomix",
    kind: "straight",
    length: 158.5
  },
  {
    id: "C103-30",
    code: "C103-30",
    name: "Mini curve",
    maker: "Tomix",
    kind: "curve",
    radius: 103,
    angle: 30
  },
  {
    id: "C140-30",
    code: "C140-30",
    name: "Mini curve",
    maker: "Tomix",
    kind: "curve",
    radius: 140,
    angle: 30
  },
  {
    id: "C177-30",
    code: "C177-30",
    name: "Mini curve",
    maker: "Tomix",
    kind: "curve",
    radius: 177,
    angle: 30
  },
  {
    id: "C243-45",
    code: "C243-45",
    name: "Standard curve",
    maker: "Tomix",
    kind: "curve",
    radius: 243,
    angle: 45
  },
  {
    id: "C243-15-PC",
    code: "C243-15-PC",
    name: "Standard curve PC",
    maker: "Tomix",
    kind: "curve",
    radius: 243,
    angle: 15
  },
  {
    id: "C280-15",
    code: "C280-15",
    name: "Standard curve",
    maker: "Tomix",
    kind: "curve",
    radius: 280,
    angle: 15
  },
  {
    id: "C280-45",
    code: "C280-45",
    name: "Standard curve",
    maker: "Tomix",
    kind: "curve",
    radius: 280,
    angle: 45
  },
  {
    id: "C317-45",
    code: "C317-45",
    name: "Standard curve",
    maker: "Tomix",
    kind: "curve",
    radius: 317,
    angle: 45
  },
  {
    id: "C317PC-45",
    code: "C317PC",
    name: "Standard curve PC",
    maker: "Tomix",
    kind: "curve",
    radius: 317,
    angle: 45
  },
  {
    id: "C354-15",
    code: "C354-15",
    name: "Standard curve",
    maker: "Tomix",
    kind: "curve",
    radius: 354,
    angle: 15
  },
  {
    id: "C354-45",
    code: "C354-45",
    name: "Standard curve",
    maker: "Tomix",
    kind: "curve",
    radius: 354,
    angle: 45
  },
  {
    id: "C391-45",
    code: "C391-45",
    name: "Wide curve",
    maker: "Tomix",
    kind: "curve",
    radius: 391,
    angle: 45
  },
  {
    id: "C541-15",
    code: "C541-15",
    name: "Wide curve",
    maker: "Tomix",
    kind: "curve",
    radius: 541,
    angle: 15
  },
  {
    id: "C541PC-15",
    code: "C541PC",
    name: "Wide curve PC",
    maker: "Tomix",
    kind: "curve",
    radius: 541,
    angle: 15
  },
  {
    id: "C605-10",
    code: "C605-10",
    name: "Wide curve",
    maker: "Tomix",
    kind: "curve",
    radius: 605,
    angle: 10
  },
  {
    id: "PL280-30",
    code: "PL280-30",
    name: "Electric point left",
    maker: "Tomix",
    kind: "turnout",
    length: 280,
    branchLength: 280,
    branchAngle: -30
  },
  {
    id: "PR280-30",
    code: "PR280-30",
    name: "Electric point right",
    maker: "Tomix",
    kind: "turnout",
    length: 280,
    branchLength: 280,
    branchAngle: -30,
    branchFrom: "end"
  },
  {
    id: "N-PY280-15",
    code: "N-PY280-15",
    name: "Y point",
    maker: "Tomix",
    kind: "turnout",
    length: 280,
    branchLength: 280,
    branchAngle: 15
  },
  {
    id: "PL541-15",
    code: "PL541-15",
    name: "Point left 541",
    maker: "Tomix",
    kind: "turnout",
    length: 140,
    branchLength: 145,
    branchAngle: -15
  },
  {
    id: "PR541-15",
    code: "PR541-15",
    name: "Point right 541",
    maker: "Tomix",
    kind: "turnout",
    length: 140,
    branchLength: 145,
    branchAngle: 15
  },
  {
    id: "N-CPL317/280-45",
    code: "N-CPL317/280-45",
    name: "Curved point left",
    maker: "Tomix",
    kind: "turnout",
    length: 225,
    branchLength: 198,
    branchAngle: 45
  },
  {
    id: "N-CPR317/280-45",
    code: "N-CPR317/280-45",
    name: "Curved point right",
    maker: "Tomix",
    kind: "turnout",
    length: 225,
    branchLength: 198,
    branchAngle: 45,
    branchFrom: "end"
  },
  {
    id: "PX280",
    code: "PX280",
    name: "Crossing section",
    maker: "Tomix",
    kind: "adapter",
    length: 280,
    note: "Crossing section placeholder"
  },
  {
    id: "EndRail-E",
    code: "End Rail E",
    name: "End rail",
    maker: "Tomix",
    kind: "adapter",
    length: 35,
    note: "End rail placeholder"
  },
  {
    id: "DeckBridge",
    code: "Deck Girder",
    name: "Deck girder bridge",
    maker: "Tomix",
    kind: "adapter",
    length: 140,
    note: "Bridge placeholder"
  },
  {
    id: "Adapter-S35",
    code: "S35-J",
    name: "Conversion joint",
    maker: "Tomix",
    kind: "adapter",
    length: 35,
    note: "Tomix/Kato adapter placeholder"
  }
];

export const TOMIX_TRACK_SETS: TrackSetDefinition[] = [
  {
    id: "image-plan-1200-600",
    code: "1200 x 600 圖面預覽",
    name: "Recognized Image Preview",
    pattern: "P",
    maker: "Tomix",
    layoutSize: { width: 1200, height: 600 },
    color: "black",
    note: "Approximate Tomix interpretation from the uploaded 1200 x 600mm plan image.",
    pieces: imagePlan1200x600()
  },
  {
    id: "basic-a",
    code: "Basic Set A",
    name: "Rail Pattern A",
    pattern: "A",
    maker: "Tomix",
    layoutSize: { width: 1120, height: 560 },
    color: "red",
    note: "91094 family oval: C280 curves with S280/S140/S140-RE straights.",
    pieces: [
      ...ovalCurves("C280-45", 280, 560),
      ...straightRun(["S280", "S140-RE", "S140"], -280, -280, 0),
      ...straightRun(["S280", "S280"], -280, 280, 0)
    ]
  },
  {
    id: "basic-b",
    code: "Basic Set B",
    name: "Passing Siding",
    pattern: "B",
    maker: "Tomix",
    layoutSize: { width: 1120, height: 56 },
    color: "green",
    note: "91092/91025/91026 style siding: PL/PR541-15 with S72.5, S280, S140 and C541-15.",
    pieces: [
      { trackId: "PL541-15", x: -490, y: 18.5, rotation: 0 },
      ...straightRun(["S280", "S280", "S280"], -420, 18.5, 0),
      { trackId: "PR541-15", x: 490, y: 18.5, rotation: 0 },
      { trackId: "S72.5", x: -384, y: -18.5, rotation: -7 },
      { trackId: "C541-15", x: -282, y: -18.5, rotation: -97.5 },
      ...straightRun(["S280", "S140"], -210, -18.5, 0),
      { trackId: "C541-15", x: 282, y: -18.5, rotation: 82.5 },
      { trackId: "S72.5", x: 384, y: -18.5, rotation: 7 }
    ]
  },
  {
    id: "basic-d-wood",
    code: "Basic Set D",
    name: "Double Track Expansion",
    pattern: "D",
    maker: "Tomix",
    layoutSize: { width: 1614, height: 634 },
    color: "blue",
    note: "91064 wood tie version: C317 oval with S280, PX280, S140 and C541-15 adjustment curves.",
    pieces: [
      ...ovalCurves("C317-45", 317, 980),
      ...straightRun(["S280", "PX280", "S280", "S140"], -490, -317, 0),
      ...straightRun(["S280", "S140"], -140, 317, 0),
      { trackId: "C541-15", x: -490, y: 317, rotation: -15 },
      { trackId: "C541-15", x: -210, y: 317, rotation: -15 },
      { trackId: "C541-15", x: 210, y: 317, rotation: 180 },
      { trackId: "C541-15", x: 490, y: 317, rotation: 180 }
    ]
  },
  {
    id: "basic-d-pc",
    code: "Basic Set D PC",
    name: "Double Track Expansion PC",
    pattern: "D",
    maker: "Tomix",
    layoutSize: { width: 1614, height: 634 },
    color: "blue",
    note: "91028 PC tie version using S280PC, S140PC, C317PC and C541PC.",
    pieces: [
      ...ovalCurves("C317PC-45", 317, 980),
      ...straightRun(["S280PC", "S280PC", "S280PC", "S140PC"], -490, -317, 0),
      ...straightRun(["S280PC", "S140PC"], -140, 317, 0),
      { trackId: "C541PC-15", x: -490, y: 317, rotation: -15 },
      { trackId: "C541PC-15", x: -210, y: 317, rotation: -15 },
      { trackId: "C541PC-15", x: 210, y: 317, rotation: 180 },
      { trackId: "C541PC-15", x: 490, y: 317, rotation: 180 }
    ]
  }
];

function ovalCurves(trackId: string, radius: number, straightSpan: number) {
  const leftX = -straightSpan / 2;
  const rightX = straightSpan / 2;
  const pivot = polar(radius, getCurveAngle(trackId) / 2);

  const curvePiece = (centerX: number, centerY: number, rotation: number) => {
    const rotatedPivot = rotatePoint(pivot.x, pivot.y, rotation);
    return {
      trackId,
      x: centerX + rotatedPivot.x,
      y: centerY + rotatedPivot.y,
      rotation
    };
  };

  return [
    ...[-90, -45, 0, 45].map((rotation) => curvePiece(rightX, 0, rotation)),
    ...[90, 135, 180, 225].map((rotation) => curvePiece(leftX, 0, rotation))
  ];
}

function imagePlan1200x600() {
  const piece = (
    trackId: string,
    x: number,
    y: number,
    rotation: number
  ): TrackSetPiece => ({
    trackId,
    x: Math.round(x - 600),
    y: Math.round(y - 300),
    rotation
  });

  return [
    // Bottom front siding from the reference drawing.
    ...straightRun(
      [
        "EndRail-E",
        "S99",
        "S99",
        "S140",
        "PR541-15",
        "S280",
        "S140",
        "S70",
        "S33",
        "S18.5"
      ],
      -580,
      270,
      0
    ),

    // Main oval, approximated to Tomix C243/C280 geometry inside 1200 x 600mm.
    piece("C243-45", 235, 105, 132),
    piece("C243-45", 140, 210, 178),
    piece("C280-45", 145, 365, 178),
    piece("C280-45", 255, 510, 222),
    piece("S140", 365, 540, 0),
    piece("PR541-15", 505, 540, 0),
    piece("S280", 665, 540, 0),
    piece("S140", 875, 540, 0),
    piece("S70", 980, 540, 0),
    piece("S33", 1040, 540, 0),
    piece("S18.5", 1080, 540, 0),
    piece("C280-45", 1050, 500, 314),
    piece("C280-45", 1110, 375, 358),
    piece("C243-45", 1080, 230, 0),
    piece("C243-45", 980, 115, 42),

    // Top route and bridge area.
    piece("C280-15", 810, 92, 18),
    piece("DeckBridge", 720, 82, -12),
    piece("C280-15", 625, 102, 166),
    piece("C354-15", 535, 108, 166),
    piece("PR541-15", 455, 118, 0),

    // Diagonal branch through the middle, estimated from the labels in the image.
    piece("C354-15", 545, 170, 38),
    piece("S70", 610, 230, 34),
    piece("C354-15", 670, 285, 30),
    piece("S140", 760, 350, 32),
    piece("S70", 865, 420, 32),
    piece("EndRail-E", 925, 455, 32),

    // Curved point callout on the lower-right connection.
    piece("N-CPL317/280-45", 975, 455, -18)
  ];
}

function straightRun(
  trackIds: string[],
  startX: number,
  y: number,
  rotation: number
) {
  let cursor = startX;
  return trackIds.map((trackId) => {
    const track = TOMIX_TRACKS.find((item) => item.id === trackId);
    const length = track && "length" in track ? track.length : 0;
    const piece = {
      trackId,
      x: cursor + length / 2,
      y,
      rotation
    };
    cursor += length;
    return piece;
  });
}

function getCurveAngle(trackId: string) {
  const track = TOMIX_TRACKS.find((item) => item.id === trackId);
  return track?.kind === "curve" ? track.angle : 45;
}

function polar(radius: number, angle: number) {
  const radians = (angle * Math.PI) / 180;
  return {
    x: Math.cos(radians) * radius,
    y: Math.sin(radians) * radius
  };
}

function rotatePoint(x: number, y: number, angle: number) {
  const radians = (angle * Math.PI) / 180;
  return {
    x: x * Math.cos(radians) - y * Math.sin(radians),
    y: x * Math.sin(radians) + y * Math.cos(radians)
  };
}
