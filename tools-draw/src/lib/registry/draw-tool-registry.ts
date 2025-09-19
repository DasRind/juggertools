import { nowISO } from '@juggertools/core-domain';
import type { Drawing, DrawingMeta, SceneSnapshot, Token } from '@juggertools/core-domain';
import type { CanvasEngine, PointerContext } from '@juggertools/core-engine';

export type DrawToolId = 'select' | 'pen' | 'arrow' | 'cone' | 'eraser';

export interface DrawTool {
  id: DrawToolId;
  label: string;
  description?: string;
  handlePointer?(context: PointerContext, runtime: DrawToolRuntime): void;
  activate?(runtime: DrawToolRuntime): void;
  deactivate?(runtime: DrawToolRuntime): void;
}

export type SelectToolEventData =
  | { kind: 'hover'; tokenId?: string }
  | { kind: 'select'; tokenId?: string }
  | { kind: 'drag'; tokenId: string }
  | { kind: 'release'; tokenId?: string };

export type PenToolEventData =
  | { kind: 'pen-start'; drawingId: string }
  | { kind: 'pen-continue'; drawingId: string }
  | { kind: 'pen-end'; drawingId: string };

export type ArrowToolEventData =
  | { kind: 'arrow-start'; drawingId: string }
  | { kind: 'arrow-update'; drawingId: string }
  | { kind: 'arrow-end'; drawingId: string };

export type ConeToolEventData =
  | { kind: 'cone-start'; drawingId: string }
  | { kind: 'cone-update'; drawingId: string }
  | { kind: 'cone-end'; drawingId: string };

export type DrawToolEventData =
  | SelectToolEventData
  | PenToolEventData
  | ArrowToolEventData
  | ConeToolEventData
  | { kind: 'erase'; drawingId?: string }
  | undefined;

export interface DrawToolEvent {
  toolId: DrawToolId;
  context: PointerContext;
  data?: DrawToolEventData;
}

export interface DrawToolRegistryOptions {
  tools?: DrawTool[];
  onEvent?: (event: DrawToolEvent) => void;
  applySceneUpdate?: (mutator: (scene: SceneSnapshot) => SceneSnapshot) => void;
}

export interface ToolEmitPayload {
  context: PointerContext;
  data?: DrawToolEventData;
}

export interface DrawToolRuntime {
  engine?: CanvasEngine;
  scene?: SceneSnapshot;
  updateScene(mutator: (scene: SceneSnapshot) => SceneSnapshot): void;
  emit(payload: ToolEmitPayload): void;
}

export class DrawToolRegistry {
  private readonly tools = new Map<DrawToolId, DrawTool>();
  private readonly onEvent: (event: DrawToolEvent) => void;
  private readonly applySceneUpdate: (mutator: (scene: SceneSnapshot) => SceneSnapshot) => void;
  private activeToolId: DrawToolId;
  private engine?: CanvasEngine;
  private scene?: SceneSnapshot;

  constructor(options: DrawToolRegistryOptions = {}) {
    const builtIns = options.tools ?? createDefaultTools();
    builtIns.forEach((tool) => this.tools.set(tool.id, tool));
    this.onEvent = options.onEvent ?? (() => {});
    this.applySceneUpdate = options.applySceneUpdate ?? (() => {});
    this.activeToolId = builtIns[0]?.id ?? 'select';
  }

  listTools(): DrawTool[] {
    return Array.from(this.tools.values());
  }

  getActiveTool(): DrawTool {
    const tool = this.tools.get(this.activeToolId);
    if (!tool) {
      throw new Error(`Unknown active tool: ${this.activeToolId}`);
    }
    return tool;
  }

  setActiveTool(id: DrawToolId): void {
    const nextTool = this.tools.get(id);
    if (!nextTool) {
      throw new Error(`Cannot activate unknown tool '${id}'.`);
    }
    if (this.activeToolId === id) {
      return;
    }
    this.getActiveTool().deactivate?.(this.runtimeContext(this.getActiveTool()));
    this.activeToolId = id;
    nextTool.activate?.(this.runtimeContext(nextTool));
  }

  attachEngine(engine: CanvasEngine | undefined): void {
    this.engine = engine;
  }

  updateScene(scene: SceneSnapshot | undefined): void {
    this.scene = scene;
  }

  handlePointer(context: PointerContext): void {
    const tool = this.tools.get(this.activeToolId);
    if (!tool) {
      return;
    }
    this.onEvent({ toolId: tool.id, context });
    tool.handlePointer?.(context, this.runtimeContext(tool));
  }

  private runtimeContext(tool: DrawTool): DrawToolRuntime {
    return {
      engine: this.engine,
      scene: this.scene,
      updateScene: (mutator) => {
        if (!this.scene) {
          return;
        }
        let nextScene: SceneSnapshot | undefined;
        this.applySceneUpdate((scene) => {
          nextScene = mutator(scene);
          return nextScene ?? scene;
        });
        if (nextScene) {
          this.scene = nextScene;
        }
      },
      emit: (payload) => {
        this.onEvent({
          toolId: tool.id,
          context: payload.context,
          data: payload.data,
        });
      },
    };
  }
}

function createDefaultTools(): DrawTool[] {
  return [
    new SelectTool(),
    new PenTool(),
    new ArrowTool(),
    new ConeTool(),
    new EraserTool(),
  ];
}

class SelectTool implements DrawTool {
  readonly id: DrawToolId = 'select';
  readonly label = 'Select';
  readonly description = 'Tokens auswählen und verschieben.';

  private activeTokenId: string | undefined;
  private hoverTokenId: string | undefined;
  private dragOffset: { dx: number; dy: number } | undefined;

  handlePointer(context: PointerContext, runtime: DrawToolRuntime): void {
    const scene = runtime.scene;
    if (!scene) {
      return;
    }

    if (context.type === 'move' && context.buttons === 0) {
      const hovered = this.findToken(scene.scene.tokens, context.fieldPoint.x, context.fieldPoint.y);
      if (hovered?.id !== this.hoverTokenId) {
        this.hoverTokenId = hovered?.id;
        runtime.emit({ context, data: { kind: 'hover', tokenId: hovered?.id } });
      }
      return;
    }

    if (context.type === 'down') {
      const token = this.findToken(scene.scene.tokens, context.fieldPoint.x, context.fieldPoint.y);
      this.activeTokenId = token?.id;
      this.dragOffset = token
        ? {
            dx: context.fieldPoint.x - token.x,
            dy: context.fieldPoint.y - token.y,
          }
        : undefined;
      runtime.emit({ context, data: { kind: 'select', tokenId: token?.id } });
      return;
    }

    if (context.type === 'move' && context.buttons > 0 && this.activeTokenId) {
      const tokenId = this.activeTokenId;
      const dx = this.dragOffset?.dx ?? 0;
      const dy = this.dragOffset?.dy ?? 0;
      runtime.updateScene((snapshot) => ({
        ...snapshot,
        scene: {
          ...snapshot.scene,
          tokens: snapshot.scene.tokens.map((token) =>
            token.id === tokenId
              ? {
                  ...token,
                  x: context.fieldPoint.x - dx,
                  y: context.fieldPoint.y - dy,
                }
              : token,
          ),
        },
      }));
      runtime.emit({ context, data: { kind: 'drag', tokenId } });
      return;
    }

    if ((context.type === 'up' || context.type === 'cancel') && this.activeTokenId) {
      runtime.emit({ context, data: { kind: 'release', tokenId: this.activeTokenId } });
      this.activeTokenId = undefined;
      this.dragOffset = undefined;
    }
  }

  private findToken(tokens: Token[], x: number, y: number): Token | undefined {
    const hitRadius = 3;
    let closest: Token | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const token of tokens) {
      const distance = Math.hypot(token.x - x, token.y - y);
      if (distance <= hitRadius && distance < bestDistance) {
        bestDistance = distance;
        closest = token;
      }
    }
    return closest;
  }
}

class PenTool implements DrawTool {
  readonly id: DrawToolId = 'pen';
  readonly label = 'Pen';
  readonly description = 'Freihand-Linien zeichnen.';

  private readonly activeStrokeIds = new Map<number, string>();
  private readonly lastPoint = new Map<number, { x: number; y: number }>();
  private readonly minDistance = 0.35;

  handlePointer(context: PointerContext, runtime: DrawToolRuntime): void {
    const pointerId = context.originalEvent?.pointerId ?? 0;
    if (context.type === 'down') {
      const drawingId = this.createDrawingId(pointerId);
      this.activeStrokeIds.set(pointerId, drawingId);
      const startPoint = toPoint(context);
      this.lastPoint.set(pointerId, startPoint);
      const meta = newDrawingMeta();
      runtime.updateScene((snapshot) => ({
        ...snapshot,
        scene: {
          ...snapshot.scene,
          drawings: [
            ...snapshot.scene.drawings,
            {
              id: drawingId,
              kind: 'pen',
              points: [startPoint],
              stroke: '#f8fafc',
              width: 2,
              meta,
            },
          ],
        },
      }));
      runtime.emit({ context, data: { kind: 'pen-start', drawingId } });
      return;
    }

    if (context.type === 'move' && context.buttons > 0) {
      const drawingId = this.activeStrokeIds.get(pointerId);
      if (!drawingId) {
        return;
      }
      const last = this.lastPoint.get(pointerId);
      const next = toPoint(context);
      if (last && Math.hypot(next.x - last.x, next.y - last.y) < this.minDistance) {
        return;
      }
      this.lastPoint.set(pointerId, next);
      runtime.updateScene((snapshot) => ({
        ...snapshot,
        scene: {
          ...snapshot.scene,
          drawings: snapshot.scene.drawings.map((drawing) => {
            if (drawing.id !== drawingId || drawing.kind !== 'pen') {
              return drawing;
            }
            return {
              ...drawing,
              points: [...drawing.points, next],
              meta: touchDrawingMeta(drawing.meta),
            };
          }),
        },
      }));
      runtime.emit({ context, data: { kind: 'pen-continue', drawingId } });
      return;
    }

    if (context.type === 'up' || context.type === 'cancel') {
      const drawingId = this.activeStrokeIds.get(pointerId);
      if (drawingId) {
        runtime.emit({ context, data: { kind: 'pen-end', drawingId } });
      }
      this.activeStrokeIds.delete(pointerId);
      this.lastPoint.delete(pointerId);
    }
  }

  private createDrawingId(pointerId: number): string {
    return `pen-${pointerId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }
}

class ArrowTool implements DrawTool {
  readonly id: DrawToolId = 'arrow';
  readonly label = 'Arrow';
  readonly description = 'Richtungs-Pfeile platzieren oder bearbeiten.';

  private readonly active = new Map<
    number,
    {
      drawingId: string;
      mode: 'create' | 'edit-to' | 'edit-from' | 'edit-move';
      anchor?: { x: number; y: number };
      startPointer?: { x: number; y: number };
      startFrom?: { x: number; y: number };
      startTo?: { x: number; y: number };
    }
  >();

  handlePointer(context: PointerContext, runtime: DrawToolRuntime): void {
    const pointerId = context.originalEvent?.pointerId ?? 0;
    const scene = runtime.scene;

    if (context.type === 'down') {
      const existing = scene ? this.hitTestArrow(scene.scene.drawings, context.fieldPoint.x, context.fieldPoint.y) : undefined;
      if (existing) {
        this.active.set(pointerId, existing.state);
        runtime.emit({ context, data: { kind: 'arrow-start', drawingId: existing.state.drawingId } });
        return;
      }

      const drawingId = this.createDrawingId(pointerId);
      const start = toPoint(context);
      this.active.set(pointerId, {
        drawingId,
        mode: 'create',
        anchor: start,
      });
      runtime.updateScene((snapshot) => ({
        ...snapshot,
        scene: {
          ...snapshot.scene,
          drawings: [
            ...snapshot.scene.drawings,
            {
              id: drawingId,
              kind: 'arrow',
              from: start,
              to: start,
              stroke: '#facc15',
              width: 2.5,
              meta: newDrawingMeta(),
            },
          ],
        },
      }));
      runtime.emit({ context, data: { kind: 'arrow-start', drawingId } });
      return;
    }

    if (context.type === 'move' && context.buttons > 0) {
      const state = this.active.get(pointerId);
      if (!state || !runtime.scene) {
        return;
      }
      const current = toPoint(context);
      runtime.updateScene((snapshot) => ({
        ...snapshot,
        scene: {
          ...snapshot.scene,
          drawings: snapshot.scene.drawings.map((drawing) => {
            if (drawing.id !== state.drawingId || drawing.kind !== 'arrow') {
              return drawing;
            }
            switch (state.mode) {
              case 'create':
              case 'edit-to':
                return {
                  ...drawing,
                  to: current,
                  meta: touchDrawingMeta(drawing.meta),
                };
              case 'edit-from':
                return {
                  ...drawing,
                  from: current,
                  meta: touchDrawingMeta(drawing.meta),
                };
              case 'edit-move': {
                if (!state.startPointer || !state.startFrom || !state.startTo) {
                  return drawing;
                }
                const dx = current.x - state.startPointer.x;
                const dy = current.y - state.startPointer.y;
                return {
                  ...drawing,
                  from: { x: state.startFrom.x + dx, y: state.startFrom.y + dy },
                  to: { x: state.startTo.x + dx, y: state.startTo.y + dy },
                  meta: touchDrawingMeta(drawing.meta),
                };
              }
            }
          }),
        },
      }));
      runtime.emit({ context, data: { kind: 'arrow-update', drawingId: state.drawingId } });
      return;
    }

    if (context.type === 'up' || context.type === 'cancel') {
      const state = this.active.get(pointerId);
      if (state) {
        runtime.emit({ context, data: { kind: 'arrow-end', drawingId: state.drawingId } });
      }
      this.active.delete(pointerId);
    }
  }

  private hitTestArrow(drawings: Drawing[], x: number, y: number):
    | { drawing: Drawing & { kind: 'arrow' }; state: { drawingId: string; mode: 'edit-to' | 'edit-from' | 'edit-move'; startPointer?: { x: number; y: number }; startFrom?: { x: number; y: number }; startTo?: { x: number; y: number } } }
    | undefined {
    for (let i = drawings.length - 1; i >= 0; i -= 1) {
      const drawing = drawings[i];
      if (drawing.kind !== 'arrow') {
        continue;
      }
      const distTo = distance({ x, y }, drawing.to);
      if (distTo <= drawing.width * 2.5) {
        return { drawing, state: { drawingId: drawing.id, mode: 'edit-to' } };
      }
      const distFrom = distance({ x, y }, drawing.from);
      if (distFrom <= drawing.width * 2.5) {
        return { drawing, state: { drawingId: drawing.id, mode: 'edit-from' } };
      }
      const distSegment = distanceToSegment({ x, y }, drawing.from, drawing.to);
      if (distSegment <= drawing.width * 1.5) {
        return {
          drawing,
          state: {
            drawingId: drawing.id,
            mode: 'edit-move',
            startPointer: { x, y },
            startFrom: drawing.from,
            startTo: drawing.to,
          },
        };
      }
    }
    return undefined;
  }

  private createDrawingId(pointerId: number): string {
    return `arrow-${pointerId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }
}

class ConeTool implements DrawTool {
  readonly id: DrawToolId = 'cone';
  readonly label = 'Cone';
  readonly description = 'Zonen oder Marker platzieren/bearbeiten.';

  private readonly active = new Map<
    number,
    {
      drawingId: string;
      mode: 'create' | 'resize' | 'move';
      origin?: { x: number; y: number };
      pointerOffset?: { dx: number; dy: number };
    }
  >();

  handlePointer(context: PointerContext, runtime: DrawToolRuntime): void {
    const pointerId = context.originalEvent?.pointerId ?? 0;
    const scene = runtime.scene;

    if (context.type === 'down') {
      const existing = scene ? this.hitTestCone(scene.scene.drawings, context.fieldPoint.x, context.fieldPoint.y) : undefined;
      if (existing) {
        this.active.set(pointerId, existing.state);
        runtime.emit({ context, data: { kind: 'cone-start', drawingId: existing.state.drawingId } });
        return;
      }

      const drawingId = this.createDrawingId(pointerId);
      const origin = toPoint(context);
      this.active.set(pointerId, {
        drawingId,
        mode: 'create',
        origin,
      });
      runtime.updateScene((snapshot) => ({
        ...snapshot,
        scene: {
          ...snapshot.scene,
          drawings: [
            ...snapshot.scene.drawings,
            {
              id: drawingId,
              kind: 'cone',
              at: origin,
              radius: 2,
              fill: 'rgba(34, 197, 94, 0.35)',
              meta: newDrawingMeta(),
            },
          ],
        },
      }));
      runtime.emit({ context, data: { kind: 'cone-start', drawingId } });
      return;
    }

    if (context.type === 'move' && context.buttons > 0) {
      const state = this.active.get(pointerId);
      if (!state || !runtime.scene) {
        return;
      }
      const current = toPoint(context);
      runtime.updateScene((snapshot) => ({
        ...snapshot,
        scene: {
          ...snapshot.scene,
          drawings: snapshot.scene.drawings.map((drawing) => {
            if (drawing.id !== state.drawingId || drawing.kind !== 'cone') {
              return drawing;
            }
            if (state.mode === 'move' && state.pointerOffset) {
              return {
                ...drawing,
                at: {
                  x: current.x - state.pointerOffset.dx,
                  y: current.y - state.pointerOffset.dy,
                },
                meta: touchDrawingMeta(drawing.meta),
              };
            }
            const origin = state.origin ?? drawing.at;
            const radius = Math.max(0.5, Math.hypot(current.x - origin.x, current.y - origin.y));
            return {
              ...drawing,
              radius,
              meta: touchDrawingMeta(drawing.meta),
            };
          }),
        },
      }));
      runtime.emit({ context, data: { kind: 'cone-update', drawingId: state.drawingId } });
      return;
    }

    if (context.type === 'up' || context.type === 'cancel') {
      const state = this.active.get(pointerId);
      if (state) {
        runtime.emit({ context, data: { kind: 'cone-end', drawingId: state.drawingId } });
      }
      this.active.delete(pointerId);
    }
  }

  private hitTestCone(drawings: Drawing[], x: number, y: number):
    | { drawing: Drawing & { kind: 'cone' }; state: { drawingId: string; mode: 'resize' | 'move'; origin?: { x: number; y: number }; pointerOffset?: { dx: number; dy: number } } }
    | undefined {
    for (let i = drawings.length - 1; i >= 0; i -= 1) {
      const drawing = drawings[i];
      if (drawing.kind !== 'cone') {
        continue;
      }
      const distance = Math.hypot(drawing.at.x - x, drawing.at.y - y);
      if (distance <= drawing.radius * 0.6) {
        return {
          drawing,
          state: {
            drawingId: drawing.id,
            mode: 'move',
            pointerOffset: { dx: x - drawing.at.x, dy: y - drawing.at.y },
          },
        };
      }
      if (distance <= drawing.radius * 1.2) {
        return {
          drawing,
          state: { drawingId: drawing.id, mode: 'resize', origin: drawing.at },
        };
      }
    }
    return undefined;
  }

  private createDrawingId(pointerId: number): string {
    return `cone-${pointerId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }
}

class EraserTool implements DrawTool {
  readonly id: DrawToolId = 'eraser';
  readonly label = 'Eraser';
  readonly description = 'Zeichnungen entfernen.';

  handlePointer(context: PointerContext, runtime: DrawToolRuntime): void {
    if (context.type !== 'down' || !runtime.scene) {
      return;
    }
    const hit = this.hitTestDrawing(runtime.scene.scene.drawings, context.fieldPoint.x, context.fieldPoint.y);
    if (!hit) {
      return;
    }
    runtime.updateScene((snapshot) => ({
      ...snapshot,
      scene: {
        ...snapshot.scene,
        drawings: snapshot.scene.drawings.filter((drawing) => drawing.id !== hit.id),
      },
    }));
    runtime.emit({ context, data: { kind: 'erase', drawingId: hit.id } });
  }

  private hitTestDrawing(drawings: Drawing[], x: number, y: number): Drawing | undefined {
    for (let i = drawings.length - 1; i >= 0; i -= 1) {
      const drawing = drawings[i];
      if (drawing.kind === 'cone') {
        const dist = distance({ x, y }, drawing.at);
        if (dist <= drawing.radius) {
          return drawing;
        }
      }
      if (drawing.kind === 'pen') {
        for (let j = 1; j < drawing.points.length; j += 1) {
          const p1 = drawing.points[j - 1];
          const p2 = drawing.points[j];
          if (distanceToSegment({ x, y }, p1, p2) <= drawing.width * 1.2) {
            return drawing;
          }
        }
      }
      if (drawing.kind === 'arrow') {
        if (distanceToSegment({ x, y }, drawing.from, drawing.to) <= drawing.width * 1.2) {
          return drawing;
        }
      }
    }
    return undefined;
  }
}

function toPoint(context: PointerContext): { x: number; y: number } {
  return {
    x: context.fieldPoint.x,
    y: context.fieldPoint.y,
  };
}

function newDrawingMeta(): DrawingMeta {
  const timestamp = nowISO();
  return { createdAt: timestamp, updatedAt: timestamp };
}

function touchDrawingMeta(meta?: DrawingMeta): DrawingMeta {
  const timestamp = nowISO();
  return {
    createdAt: meta?.createdAt ?? timestamp,
    updatedAt: timestamp,
    authorId: meta?.authorId,
    notes: meta?.notes,
  };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceToSegment(point: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = point.x - a.x;
  const apy = point.y - a.y;
  const abLenSq = abx * abx + aby * aby;
  const t = abLenSq !== 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq)) : 0;
  const closestX = a.x + abx * t;
  const closestY = a.y + aby * t;
  return Math.hypot(point.x - closestX, point.y - closestY);
}
