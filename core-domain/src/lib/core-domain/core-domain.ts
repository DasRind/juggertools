// Domain model definitions shared between Jugger Tactics and Analytics tools.
// This library intentionally keeps entities minimal so other packages can build upon it.

export type ID = string;

export type TeamSide = 'left' | 'right';

export type DuelOutcome = 'leftWin' | 'double' | 'rightWin';

export interface FieldLine {
  kind: 'center' | 'zone' | 'mark';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
}

export interface FieldSpec {
  width: number;
  height: number;
  lines?: FieldLine[];
  backgroundColor?: string;
}

export type Orientation = 'landscape' | 'portrait';

export interface Player {
  id: ID;
  name: string;
  role?: string;
  number?: string;
  avatarUrl?: string;
}

export interface Team {
  id: ID;
  name: string;
  color: string;
  logoUrl?: string;
  players: Player[];
}

export interface Token {
  id: ID;
  teamId: ID;
  playerId?: ID;
  x: number;
  y: number;
  rotation?: number;
  label?: string;
  color?: string;
  shape?: 'circle' | 'rectangle';
  width?: number;
  height?: number;
}

export interface DrawingMeta {
  createdAt: string;
  updatedAt: string;
  authorId?: ID;
  notes?: string;
}

export interface PenDrawing {
  id: ID;
  kind: 'pen';
  points: Array<{ x: number; y: number }>;
  stroke: string;
  width: number;
  meta?: DrawingMeta;
}

export interface ArrowDrawing {
  id: ID;
  kind: 'arrow';
  from: { x: number; y: number };
  to: { x: number; y: number };
  stroke: string;
  width: number;
  meta?: DrawingMeta;
}

export interface LineDrawing {
  id: ID;
  kind: 'line';
  points: Array<{ x: number; y: number }>;
  stroke: string;
  width: number;
  meta?: DrawingMeta;
}

export interface ConeDrawing {
  id: ID;
  kind: 'cone';
  at: { x: number; y: number };
  radius: number;
  fill: string;
  meta?: DrawingMeta;
}

export interface ImageDrawing {
  id: ID;
  kind: 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  src: string;
  opacity?: number;
  meta?: DrawingMeta;
}

export type Drawing = PenDrawing | ArrowDrawing | LineDrawing | ImageDrawing | ConeDrawing;

export interface Scene {
  id: ID;
  field: FieldSpec;
  orientation: Orientation;
  tokens: Token[];
  drawings: Drawing[];
  leftTeamId: ID;
  rightTeamId: ID;
  lastUpdatedAt: string;
}

export interface SceneSummary {
  id: ID;
  name: string;
  teamIds: ID[];
  updatedAt: string;
}

export interface SceneSnapshot {
  scene: Scene;
  leftTeam: Team;
  rightTeam: Team;
}

export interface TeamRef {
  id: ID;
  name: string;
  logoUrl?: string;
  color?: string;
}

export interface PlayerRef {
  id: ID;
  teamId: ID;
  name: string;
  number?: string;
  role?: string;
}

export interface LineupSlot {
  playerId: ID;
  position?: { x: number; y: number };
}

export interface Lineup {
  left: LineupSlot[];
  right: LineupSlot[];
}

export interface Turn {
  id: ID;
  index: number;
  lineup: Lineup;
  outcome: DuelOutcome;
  notes?: string;
  ts: string;
}

export interface GameMeta {
  tournament?: string;
  createdAt: string;
  createdBy?: string;
  version: string;
}

export interface GameRecord {
  id: ID;
  left: TeamRef;
  right: TeamRef;
  players: PlayerRef[];
  turns: Turn[];
  winner?: TeamSide | 'abort';
  aborted?: boolean;
  meta: GameMeta;
}

export const TURN_VERSION = '1.0.0';

export const SCENE_VERSION = '1.0.0';

export function nowISO(): string {
  return new Date().toISOString();
}

export function createSceneSnapshot(params: {
  id: ID;
  field: FieldSpec;
  orientation?: Orientation;
  leftTeam: Team;
  rightTeam: Team;
  tokens?: Token[];
  drawings?: Drawing[];
  updatedAt?: string;
}): SceneSnapshot {
  const {
    id,
    field,
    orientation = 'landscape',
    leftTeam,
    rightTeam,
    tokens = [],
    drawings = [],
    updatedAt,
  } = params;

  const scene: Scene = {
    id,
    field,
    orientation,
    tokens,
    drawings,
    leftTeamId: leftTeam.id,
    rightTeamId: rightTeam.id,
    lastUpdatedAt: updatedAt ?? nowISO(),
  };

  return {
    scene,
    leftTeam,
    rightTeam,
  };
}

export function createEmptyLineup(): Lineup {
  return { left: [], right: [] };
}

export function createTurn(params: {
  id: ID;
  index: number;
  lineup: Lineup;
  outcome: DuelOutcome;
  ts?: string;
  notes?: string;
}): Turn {
  const { id, index, lineup, outcome, ts, notes } = params;
  return {
    id,
    index,
    lineup,
    outcome,
    notes,
    ts: ts ?? nowISO(),
  };
}

export function createGameRecord(params: {
  id: ID;
  left: TeamRef;
  right: TeamRef;
  players: PlayerRef[];
  turns?: Turn[];
  winner?: TeamSide | 'abort';
  aborted?: boolean;
  meta?: Partial<GameMeta>;
}): GameRecord {
  const { id, left, right, players, turns = [], winner, aborted, meta } = params;
  return {
    id,
    left,
    right,
    players,
    turns,
    winner,
    aborted,
    meta: {
      createdAt: meta?.createdAt ?? nowISO(),
      version: meta?.version ?? TURN_VERSION,
      createdBy: meta?.createdBy,
      tournament: meta?.tournament,
    },
  };
}

export function assertMinActivePlayers(lineup: Lineup, minimum = 5): void {
  const activeLeft = lineup.left.length;
  const activeRight = lineup.right.length;
  if (activeLeft < minimum || activeRight < minimum) {
    throw new Error(
      `Lineup invalid: left=${activeLeft}, right=${activeRight}, expected at least ${minimum} pro Seite.`,
    );
  }
}

export function collectPlayerIds(lineup: Lineup): ID[] {
  return [...lineup.left, ...lineup.right].map((slot) => slot.playerId);
}
