import { nowISO } from '@juggertools/core-domain';
import type {
  Drawing,
  DrawingMeta,
  SceneSnapshot,
  Token,
  LineDrawing,
} from '@juggertools/core-domain';
import type { CanvasEngine, PointerContext } from '@juggertools/core-engine';

export type DrawToolId =
  | 'select'
  | 'line'
  | 'pen'
  | 'arrow'
  | 'cone'
  | 'eraser';

export interface DrawTool {
  id: DrawToolId;
  label: string;
  description?: string;
  handlePointer?(context: PointerContext, runtime: DrawToolRuntime): void;
  activate?(runtime: DrawToolRuntime): void;
  deactivate?(runtime: DrawToolRuntime): void;
  configure?(config: unknown): void;
}

export type SelectTarget =
  | { type: 'token'; id: string }
  | {
      type: 'drawing';
      id: string;
      handle?: 'start' | 'end' | 'radius';
      action?: 'delete';
    };

export type SelectToolEventData =
  | { kind: 'hover'; target?: SelectTarget }
  | { kind: 'select'; target?: SelectTarget }
  | { kind: 'drag'; target: SelectTarget }
  | { kind: 'release'; target?: SelectTarget };

export type LineToolEventData =
  | { kind: 'line-start'; drawingId: string }
  | { kind: 'line-update'; drawingId: string }
  | { kind: 'line-end'; drawingId: string };

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
  | LineToolEventData
  | PenToolEventData
  | ArrowToolEventData
  | ConeToolEventData
  | { kind: 'erase'; drawingId?: string }
  | undefined;

const VISUAL_SCALE = 3.4;
const TOKEN_HIT_RADIUS = 3.2 * VISUAL_SCALE;
export const LINE_HANDLE_RADIUS = 3.6 * VISUAL_SCALE;
const LINE_HIT_THRESHOLD = 1.6 * VISUAL_SCALE;
export const LINE_DELETE_ICON_RADIUS = 2.4 * VISUAL_SCALE;
export const LINE_DELETE_ICON_OFFSET = {
  x: 0,
  y: -4 * VISUAL_SCALE,
} as const;
export const IMAGE_DELETE_ICON_RADIUS = LINE_DELETE_ICON_RADIUS;
export const IMAGE_DELETE_ICON_OFFSET = {
  x: 2.4 * VISUAL_SCALE,
  y: 2.4 * VISUAL_SCALE,
} as const;

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
  private readonly applySceneUpdate: (
    mutator: (scene: SceneSnapshot) => SceneSnapshot
  ) => void;
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
    this.getActiveTool().deactivate?.(
      this.runtimeContext(this.getActiveTool())
    );
    this.activeToolId = id;
    nextTool.activate?.(this.runtimeContext(nextTool));
  }

  configureTool<TConfig = unknown>(id: DrawToolId, config: TConfig): void {
    const tool = this.tools.get(id);
    tool?.configure?.(config);
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
    new LineTool(),
    new PenTool(),
    new ArrowTool(),
    new ConeTool(),
    new EraserTool(),
  ];
}

type DragState =
  | {
      mode: 'token';
      tokenId: string;
      offset: { dx: number; dy: number };
    }
  | {
      mode: 'line';
      drawingId: string;
      startPointer: { x: number; y: number };
      startPoints: Array<{ x: number; y: number }>;
    }
  | {
      mode: 'line-handle';
      drawingId: string;
      handle: 'start' | 'end';
    }
  | {
      mode: 'image';
      drawingId: string;
      offset: { dx: number; dy: number };
    }
  | {
      mode: 'arrow';
      drawingId: string;
      startPointer: { x: number; y: number };
      startFrom: { x: number; y: number };
      startTo: { x: number; y: number };
    }
  | {
      mode: 'arrow-handle';
      drawingId: string;
      handle: 'start' | 'end';
    }
  | {
      mode: 'cone';
      drawingId: string;
      offset: { dx: number; dy: number };
    }
  | {
      mode: 'cone-radius';
      drawingId: string;
    };

class SelectTool implements DrawTool {
  readonly id: DrawToolId = 'select';
  readonly label = 'Select';
  readonly description = 'Elemente auswählen, verschieben und bearbeiten.';

  private hovered?: SelectTarget;
  private selected?: SelectTarget;
  private dragState?: DragState;
  private tokenRadius = TOKEN_HIT_RADIUS;

  configure(config: unknown): void {
    if (!config || typeof config !== 'object') {
      return;
    }
    const maybe = config as { tokenRadius?: unknown };
    if (typeof maybe.tokenRadius === 'number' && Number.isFinite(maybe.tokenRadius)) {
      this.tokenRadius = Math.max(0.5, maybe.tokenRadius);
    }
  }

  handlePointer(context: PointerContext, runtime: DrawToolRuntime): void {
    const scene = runtime.scene;
    if (!scene) {
      return;
    }

    if (context.type === 'move' && context.buttons === 0) {
      this.handleHover(context, scene, runtime);
      return;
    }

    if (context.type === 'down') {
      this.handleDown(context, scene, runtime);
      return;
    }

    if (context.type === 'move' && context.buttons > 0) {
      this.handleDrag(context, runtime);
      return;
    }

    if (context.type === 'up' || context.type === 'cancel') {
      this.handleUp(context, runtime);
    }
  }

  private handleHover(
    context: PointerContext,
    scene: SceneSnapshot,
    runtime: DrawToolRuntime
  ): void {
    const target = this.findHoverTarget(
      scene,
      context.fieldPoint.x,
      context.fieldPoint.y
    );
    if (!this.isSameTarget(target, this.hovered)) {
      this.hovered = target;
      runtime.emit({ context, data: { kind: 'hover', target } });
    }
  }

  private handleDown(
    context: PointerContext,
    scene: SceneSnapshot,
    runtime: DrawToolRuntime
  ): void {
    const target = this.pickTarget(
      scene,
      context.fieldPoint.x,
      context.fieldPoint.y
    );

    if (target?.type === 'drawing' && target.action === 'delete') {
      this.deleteDrawing(target.id, runtime);
      this.selected = undefined;
      this.dragState = undefined;
      runtime.emit({ context, data: { kind: 'select', target: undefined } });
      return;
    }

    this.dragState = undefined;

    if (!target) {
      if (this.selected) {
        this.selected = undefined;
        runtime.emit({ context, data: { kind: 'select', target: undefined } });
      }
      return;
    }

    if (target.type === 'token') {
      const token = this.findTokenById(scene.scene.tokens, target.id);
      const offset = token
        ? {
            dx: context.fieldPoint.x - token.x,
            dy: context.fieldPoint.y - token.y,
          }
        : { dx: 0, dy: 0 };
      this.dragState = { mode: 'token', tokenId: target.id, offset };
      this.selected = target;
      runtime.emit({ context, data: { kind: 'select', target } });
      return;
    }

    if (target.type === 'drawing') {
      const baseSelection: SelectTarget = { type: 'drawing', id: target.id };
      const drawing = this.findDrawingById(scene.scene.drawings, target.id);

      if (
        (target.handle === 'start' || target.handle === 'end') &&
        drawing?.kind === 'line'
      ) {
        this.dragState = {
          mode: 'line-handle',
          drawingId: target.id,
          handle: target.handle,
        };
        this.selected = baseSelection;
        runtime.emit({
          context,
          data: { kind: 'select', target: baseSelection },
        });
        return;
      }

      if (
        (target.handle === 'start' || target.handle === 'end') &&
        drawing?.kind === 'arrow'
      ) {
        this.dragState = {
          mode: 'arrow-handle',
          drawingId: target.id,
          handle: target.handle,
        };
        this.selected = baseSelection;
        runtime.emit({
          context,
          data: { kind: 'select', target: baseSelection },
        });
        return;
      }

      if (target.handle === 'radius' && drawing?.kind === 'cone') {
        this.dragState = {
          mode: 'cone-radius',
          drawingId: target.id,
        };
        this.selected = baseSelection;
        runtime.emit({
          context,
          data: { kind: 'select', target: baseSelection },
        });
        return;
      }

      if (drawing?.kind === 'line') {
        this.dragState = {
          mode: 'line',
          drawingId: target.id,
          startPointer: { x: context.fieldPoint.x, y: context.fieldPoint.y },
          startPoints: drawing.points.map((point) => ({
            x: point.x,
            y: point.y,
          })),
        };
      } else if (drawing?.kind === 'arrow') {
        this.dragState = {
          mode: 'arrow',
          drawingId: target.id,
          startPointer: { x: context.fieldPoint.x, y: context.fieldPoint.y },
          startFrom: { x: drawing.from.x, y: drawing.from.y },
          startTo: { x: drawing.to.x, y: drawing.to.y },
        };
      } else if (drawing?.kind === 'image') {
        this.dragState = {
          mode: 'image',
          drawingId: target.id,
          offset: {
            dx: context.fieldPoint.x - drawing.x,
            dy: context.fieldPoint.y - drawing.y,
          },
        };
      } else if (drawing?.kind === 'cone') {
        this.dragState = {
          mode: 'cone',
          drawingId: target.id,
          offset: {
            dx: context.fieldPoint.x - drawing.at.x,
            dy: context.fieldPoint.y - drawing.at.y,
          },
        };
      }

      this.selected = baseSelection;
      runtime.emit({
        context,
        data: { kind: 'select', target: baseSelection },
      });
    }
  }

  private handleDrag(context: PointerContext, runtime: DrawToolRuntime): void {
    if (!this.dragState || !runtime.scene) {
      return;
    }
    const state = this.dragState;

    if (state.mode === 'token') {
      const target: SelectTarget = { type: 'token', id: state.tokenId };
      runtime.updateScene((snapshot) => ({
        ...snapshot,
        scene: {
          ...snapshot.scene,
          tokens: snapshot.scene.tokens.map((token) =>
            token.id === state.tokenId
              ? {
                  ...token,
                  x: context.fieldPoint.x - state.offset.dx,
                  y: context.fieldPoint.y - state.offset.dy,
                }
              : token
          ),
        },
      }));
      runtime.emit({ context, data: { kind: 'drag', target } });
      return;
    }

    if (state.mode === 'line-handle') {
      const target: SelectTarget = {
        type: 'drawing',
        id: state.drawingId,
        handle: state.handle,
      };
      runtime.updateScene((snapshot) => ({
        ...snapshot,
        scene: {
          ...snapshot.scene,
          drawings: snapshot.scene.drawings.map((drawing) => {
            if (drawing.id !== state.drawingId || drawing.kind !== 'line') {
              return drawing;
            }
            const lastIndex = drawing.points.length - 1;
            const nextPoints = drawing.points.map((point, index) => {
              if (state.handle === 'start' && index === 0) {
                return { x: context.fieldPoint.x, y: context.fieldPoint.y };
              }
              if (state.handle === 'end' && index === lastIndex) {
                return { x: context.fieldPoint.x, y: context.fieldPoint.y };
              }
              return point;
            });
            return {
              ...drawing,
              points: nextPoints,
              meta: touchDrawingMeta(drawing.meta),
            };
          }),
        },
      }));
      runtime.emit({ context, data: { kind: 'drag', target } });
      return;
    }

    if (state.mode === 'arrow-handle') {
      const target: SelectTarget = {
        type: 'drawing',
        id: state.drawingId,
        handle: state.handle,
      };
      runtime.updateScene((snapshot) => ({
        ...snapshot,
        scene: {
          ...snapshot.scene,
          drawings: snapshot.scene.drawings.map((drawing) => {
            if (drawing.id !== state.drawingId || drawing.kind !== 'arrow') {
              return drawing;
            }
            const isStart = state.handle === 'start';
            const updated = {
              ...drawing,
              from: isStart
                ? { x: context.fieldPoint.x, y: context.fieldPoint.y }
                : drawing.from,
              to: !isStart
                ? { x: context.fieldPoint.x, y: context.fieldPoint.y }
                : drawing.to,
            };
            return { ...updated, meta: touchDrawingMeta(drawing.meta) };
          }),
        },
      }));
      runtime.emit({ context, data: { kind: 'drag', target } });
      return;
    }

    if (state.mode === 'image') {
      const target: SelectTarget = { type: 'drawing', id: state.drawingId };
      runtime.updateScene((snapshot) => ({
        ...snapshot,
        scene: {
          ...snapshot.scene,
          drawings: snapshot.scene.drawings.map((drawing) => {
            if (drawing.id !== state.drawingId || drawing.kind !== 'image') {
              return drawing;
            }
            return {
              ...drawing,
              x: context.fieldPoint.x - state.offset.dx,
              y: context.fieldPoint.y - state.offset.dy,
              meta: touchDrawingMeta(drawing.meta),
            };
          }),
        },
      }));
      runtime.emit({ context, data: { kind: 'drag', target } });
      return;
    }

    if (state.mode === 'line') {
      const target: SelectTarget = { type: 'drawing', id: state.drawingId };
      const dx = context.fieldPoint.x - state.startPointer.x;
      const dy = context.fieldPoint.y - state.startPointer.y;
      runtime.updateScene((snapshot) => ({
        ...snapshot,
        scene: {
          ...snapshot.scene,
          drawings: snapshot.scene.drawings.map((drawing) => {
            if (drawing.id !== state.drawingId || drawing.kind !== 'line') {
              return drawing;
            }
            const nextPoints = state.startPoints.map((point) => ({
              x: point.x + dx,
              y: point.y + dy,
            }));
            return {
              ...drawing,
              points: nextPoints,
              meta: touchDrawingMeta(drawing.meta),
            };
          }),
        },
      }));
      runtime.emit({ context, data: { kind: 'drag', target } });
      return;
    }

    if (state.mode === 'arrow') {
      const target: SelectTarget = { type: 'drawing', id: state.drawingId };
      const dx = context.fieldPoint.x - state.startPointer.x;
      const dy = context.fieldPoint.y - state.startPointer.y;
      runtime.updateScene((snapshot) => ({
        ...snapshot,
        scene: {
          ...snapshot.scene,
          drawings: snapshot.scene.drawings.map((drawing) => {
            if (drawing.id !== state.drawingId || drawing.kind !== 'arrow') {
              return drawing;
            }
            return {
              ...drawing,
              from: { x: state.startFrom.x + dx, y: state.startFrom.y + dy },
              to: { x: state.startTo.x + dx, y: state.startTo.y + dy },
              meta: touchDrawingMeta(drawing.meta),
            };
          }),
        },
      }));
      runtime.emit({ context, data: { kind: 'drag', target } });
      return;
    }

    if (state.mode === 'cone') {
      const target: SelectTarget = { type: 'drawing', id: state.drawingId };
      runtime.updateScene((snapshot) => ({
        ...snapshot,
        scene: {
          ...snapshot.scene,
          drawings: snapshot.scene.drawings.map((drawing) => {
            if (drawing.id !== state.drawingId || drawing.kind !== 'cone') {
              return drawing;
            }
            return {
              ...drawing,
              at: {
                x: context.fieldPoint.x - state.offset.dx,
                y: context.fieldPoint.y - state.offset.dy,
              },
              meta: touchDrawingMeta(drawing.meta),
            };
          }),
        },
      }));
      runtime.emit({ context, data: { kind: 'drag', target } });
      return;
    }

    if (state.mode === 'cone-radius') {
      const target: SelectTarget = {
        type: 'drawing',
        id: state.drawingId,
        handle: 'radius',
      };
      runtime.updateScene((snapshot) => ({
        ...snapshot,
        scene: {
          ...snapshot.scene,
          drawings: snapshot.scene.drawings.map((drawing) => {
            if (drawing.id !== state.drawingId || drawing.kind !== 'cone') {
              return drawing;
            }
            const radius = Math.max(
              0.5,
              distance(drawing.at, {
                x: context.fieldPoint.x,
                y: context.fieldPoint.y,
              })
            );
            return {
              ...drawing,
              radius,
              meta: touchDrawingMeta(drawing.meta),
            };
          }),
        },
      }));
      runtime.emit({ context, data: { kind: 'drag', target } });
      return;
    }
  }

  private handleUp(context: PointerContext, runtime: DrawToolRuntime): void {
    if (!this.dragState) {
      return;
    }
    const state = this.dragState;
    this.dragState = undefined;

    if (state.mode === 'token') {
      runtime.emit({
        context,
        data: { kind: 'release', target: { type: 'token', id: state.tokenId } },
      });
      return;
    }
    runtime.emit({
      context,
      data: {
        kind: 'release',
        target: { type: 'drawing', id: state.drawingId },
      },
    });
  }

  private findHoverTarget(
    scene: SceneSnapshot,
    x: number,
    y: number
  ): SelectTarget | undefined {
    const handleTarget = this.hitDrawingHandles(
      scene.scene.drawings,
      x,
      y,
      this.selected
    );
    if (handleTarget) {
      return handleTarget;
    }

    const token = this.findToken(scene.scene.tokens, x, y);
    if (token) {
      return { type: 'token', id: token.id };
    }

    const drawingTarget = this.hitDrawings(scene.scene.drawings, x, y);
    if (drawingTarget) {
      return drawingTarget;
    }
    return undefined;
  }

  private pickTarget(
    scene: SceneSnapshot,
    x: number,
    y: number
  ): SelectTarget | undefined {
    if (this.selected?.type === 'drawing') {
      const selectedDrawing = this.findDrawingById(
        scene.scene.drawings,
        this.selected.id
      );
      if (selectedDrawing) {
        const iconTarget = this.hitDeleteIcon(selectedDrawing, x, y);
        if (iconTarget) {
          return iconTarget;
        }
      }
    }

    const handleTarget = this.hitDrawingHandles(
      scene.scene.drawings,
      x,
      y,
      this.selected
    );
    if (handleTarget) {
      return handleTarget;
    }

    const token = this.findToken(scene.scene.tokens, x, y);
    if (token) {
      return { type: 'token', id: token.id };
    }

    return this.hitDrawings(scene.scene.drawings, x, y);
  }

  private hitDrawings(
    drawings: Drawing[],
    x: number,
    y: number
  ): SelectTarget | undefined {
    for (let index = drawings.length - 1; index >= 0; index -= 1) {
      const drawing = drawings[index];
      if (drawing.kind === 'image') {
        if (isPointInsideImage(drawing, x, y)) {
          return { type: 'drawing', id: drawing.id };
        }
        continue;
      }
      if (drawing.kind === 'line') {
        if (this.isPointNearLine(drawing.points, x, y, drawing.width)) {
          return { type: 'drawing', id: drawing.id };
        }
        continue;
      }
      if (drawing.kind === 'arrow') {
        if (
          distanceToSegment({ x, y }, drawing.from, drawing.to) <=
          drawing.width + LINE_HIT_THRESHOLD
        ) {
          return { type: 'drawing', id: drawing.id };
        }
        continue;
      }
      if (drawing.kind === 'cone') {
        const dist = distance({ x, y }, drawing.at);
        if (dist <= drawing.radius) {
          return { type: 'drawing', id: drawing.id };
        }
        continue;
      }
      if (drawing.kind === 'pen') {
        if (this.isPointNearLine(drawing.points, x, y, drawing.width)) {
          return { type: 'drawing', id: drawing.id };
        }
      }
    }
    return undefined;
  }

  private hitDrawingHandles(
    drawings: Drawing[],
    x: number,
    y: number,
    preferred?: SelectTarget
  ): SelectTarget | undefined {
    const preferredId =
      preferred?.type === 'drawing' ? preferred.id : undefined;

    const checkDrawing = (drawing: Drawing): SelectTarget | undefined => {
      if (drawing.kind === 'line' && drawing.points.length > 0) {
        return this.hitHandlesForLine(drawing, x, y);
      }
      if (drawing.kind === 'arrow') {
        return this.hitHandlesForArrow(drawing, x, y);
      }
      if (drawing.kind === 'cone') {
        return this.hitHandlesForCone(drawing, x, y);
      }
      return undefined;
    };

    if (preferredId) {
      for (let index = drawings.length - 1; index >= 0; index -= 1) {
        const drawing = drawings[index];
        if (drawing.id !== preferredId) {
          continue;
        }
        const target = checkDrawing(drawing);
        if (target) {
          return target;
        }
        break;
      }
    }

    for (let index = drawings.length - 1; index >= 0; index -= 1) {
      const drawing = drawings[index];
      const target = checkDrawing(drawing);
      if (target) {
        return target;
      }
    }
    return undefined;
  }

  private hitHandlesForLine(
    drawing: Drawing & { kind: 'line' },
    x: number,
    y: number
  ): SelectTarget | undefined {
    const { start, end } = getLineEndpoints(drawing.points);
    if (distance(start, { x, y }) <= LINE_HANDLE_RADIUS) {
      return { type: 'drawing', id: drawing.id, handle: 'start' };
    }
    if (distance(end, { x, y }) <= LINE_HANDLE_RADIUS) {
      return { type: 'drawing', id: drawing.id, handle: 'end' };
    }
    return undefined;
  }

  private hitHandlesForArrow(
    drawing: Drawing & { kind: 'arrow' },
    x: number,
    y: number
  ): SelectTarget | undefined {
    if (distance(drawing.from, { x, y }) <= LINE_HANDLE_RADIUS) {
      return { type: 'drawing', id: drawing.id, handle: 'start' };
    }
    if (distance(drawing.to, { x, y }) <= LINE_HANDLE_RADIUS) {
      return { type: 'drawing', id: drawing.id, handle: 'end' };
    }
    return undefined;
  }

  private hitHandlesForCone(
    drawing: Drawing & { kind: 'cone' },
    x: number,
    y: number
  ): SelectTarget | undefined {
    const handlePoint = { x: drawing.at.x + drawing.radius, y: drawing.at.y };
    if (distance(handlePoint, { x, y }) <= LINE_HANDLE_RADIUS) {
      return { type: 'drawing', id: drawing.id, handle: 'radius' };
    }
    return undefined;
  }

  private hitDeleteIcon(
    drawing: Drawing,
    x: number,
    y: number
  ): SelectTarget | undefined {
    return undefined;
  }

  private isPointNearLine(
    points: Array<{ x: number; y: number }>,
    x: number,
    y: number,
    strokeWidth: number
  ): boolean {
    if (points.length < 2) {
      return false;
    }
    const threshold = Math.max(LINE_HIT_THRESHOLD, strokeWidth / 2);
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      if (distanceToSegment({ x, y }, from, to) <= threshold) {
        return true;
      }
    }
    return false;
  }

  private deleteDrawing(id: string, runtime: DrawToolRuntime): void {
    runtime.updateScene((snapshot) => ({
      ...snapshot,
      scene: {
        ...snapshot.scene,
        drawings: snapshot.scene.drawings.filter(
          (drawing) => drawing.id !== id
        ),
      },
    }));
  }

  private findToken(tokens: Token[], x: number, y: number): Token | undefined {
    let closest: Token | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const token of tokens) {
      if (token.shape === 'rectangle' && token.width && token.height) {
        const halfWidth = token.width / 2;
        const halfHeight = token.height / 2;
        const within =
          Math.abs(token.x - x) <= halfWidth &&
          Math.abs(token.y - y) <= halfHeight;
        if (within) {
          const centerDistance = distance(token, { x, y });
          if (centerDistance < bestDistance) {
            bestDistance = centerDistance;
            closest = token;
          }
        }
        continue;
      }
      const dist = distance(token, { x, y });
      if (dist <= this.tokenRadius && dist < bestDistance) {
        bestDistance = dist;
        closest = token;
      }
    }
    return closest;
  }

  private findTokenById(tokens: Token[], id: string): Token | undefined {
    return tokens.find((token) => token.id === id);
  }

  private findDrawingById(
    drawings: Drawing[],
    id: string
  ): Drawing | undefined {
    return drawings.find((drawing) => drawing.id === id);
  }

  private isSameTarget(
    a: SelectTarget | undefined,
    b: SelectTarget | undefined
  ): boolean {
    if (!a && !b) {
      return true;
    }
    if (!a || !b) {
      return false;
    }
    if (a.type !== b.type) {
      return false;
    }
    if (a.id !== b.id) {
      return false;
    }
    if (a.type === 'drawing' && b.type === 'drawing') {
      return a.handle === b.handle && a.action === b.action;
    }
    return true;
  }
}

interface LinePointerSession {
  drawingId: string;
  mode: 'create' | 'edit-start' | 'edit-end' | 'edit-move';
  anchor: { x: number; y: number };
  originalPoints: Array<{ x: number; y: number }>;
}

class LineTool implements DrawTool {
  readonly id: DrawToolId = 'line';
  readonly label = 'Line';
  readonly description = 'Linien zeichnen und bearbeiten.';

  private readonly sessions = new Map<number, LinePointerSession>();
  private hovered?: SelectTarget;
  private stroke = '#1f2937';
  private width = 1.6 * VISUAL_SCALE;
  private selectedId?: string;

  configure(config: unknown): void {
    if (!config || typeof config !== 'object') {
      return;
    }
    const maybe = config as { color?: unknown; width?: unknown };
    if (typeof maybe.color === 'string') {
      this.stroke = maybe.color;
    }
    if (typeof maybe.width === 'number' && Number.isFinite(maybe.width)) {
      this.width = Math.max(0.4, Math.min(maybe.width, 10));
    }
  }

  handlePointer(context: PointerContext, runtime: DrawToolRuntime): void {
    const pointerId = context.originalEvent?.pointerId ?? 0;
    const point = toPoint(context);
    const session = this.sessions.get(pointerId);

    if (context.type === 'move' && context.buttons === 0) {
      this.emitHover(context, runtime, point);
      return;
    }

    if (context.type === 'down') {
      const scene = runtime.scene;
      const editable = scene ? this.findEditableTarget(scene, point) : undefined;
      if (editable) {
        this.selectedId = editable.drawing.id;
        this.sessions.set(pointerId, {
          drawingId: editable.drawing.id,
          mode: editable.mode,
          anchor: point,
          originalPoints: editable.drawing.points.map((p) => ({ ...p })),
        });
        runtime.emit({
          context,
          data: {
            kind: 'select',
            target: { type: 'drawing', id: editable.drawing.id },
          },
        });
        return;
      }

      const candidate = scene
        ? this.findLineAtPoint(scene.scene.drawings, point)
        : undefined;
      if (candidate) {
        this.selectedId = candidate.id;
        runtime.emit({
          context,
          data: {
            kind: 'select',
            target: { type: 'drawing', id: candidate.id },
          },
        });
        return;
      }

      const drawingId = this.createDrawingId(pointerId);
      const start = point;
      this.sessions.set(pointerId, {
        drawingId,
        mode: 'create',
        anchor: start,
        originalPoints: [start, start],
      });
      runtime.updateScene((snapshot) => ({
        ...snapshot,
        scene: {
          ...snapshot.scene,
          drawings: [
            ...snapshot.scene.drawings,
            {
              id: drawingId,
              kind: 'line',
              points: [start, start],
              stroke: this.stroke,
              width: this.width,
              meta: newDrawingMeta(),
            },
          ],
        },
      }));
      runtime.emit({ context, data: { kind: 'line-start', drawingId } });
      return;
    }

    if (context.type === 'move' && context.buttons > 0 && session) {
      this.updateActiveLine(session, point, runtime, context);
      return;
    }

    if ((context.type === 'up' || context.type === 'cancel') && session) {
      this.finishInteraction(session, point, runtime, context);
      this.sessions.delete(pointerId);
    }
  }

  private emitHover(
    context: PointerContext,
    runtime: DrawToolRuntime,
    point: { x: number; y: number }
  ): void {
    const scene = runtime.scene;
    if (!scene) {
      return;
    }
    const target = this.findHoverTarget(scene, point);
    if (!this.isSameTarget(target, this.hovered)) {
      this.hovered = target ?? undefined;
      runtime.emit({ context, data: { kind: 'hover', target } });
    }
  }

  private updateActiveLine(
    session: LinePointerSession,
    point: { x: number; y: number },
    runtime: DrawToolRuntime,
    context: PointerContext
  ): void {
    switch (session.mode) {
      case 'create': {
        this.applyLinePoints(runtime, session.drawingId, (drawing) => {
          const points = drawing.points.slice();
          points[points.length - 1] = point;
          return points;
        });
        runtime.emit({
          context,
          data: { kind: 'line-update', drawingId: session.drawingId },
        });
        break;
      }
      case 'edit-start': {
        const updated = session.originalPoints.slice();
        updated[0] = point;
        this.applyLinePoints(runtime, session.drawingId, () => updated);
        runtime.emit({
          context,
          data: { kind: 'line-update', drawingId: session.drawingId },
        });
        break;
      }
      case 'edit-end': {
        const updated = session.originalPoints.slice();
        updated[updated.length - 1] = point;
        this.applyLinePoints(runtime, session.drawingId, () => updated);
        runtime.emit({
          context,
          data: { kind: 'line-update', drawingId: session.drawingId },
        });
        break;
      }
      case 'edit-move': {
        const dx = point.x - session.anchor.x;
        const dy = point.y - session.anchor.y;
        const updated = session.originalPoints.map((p) => ({
          x: p.x + dx,
          y: p.y + dy,
        }));
        this.applyLinePoints(runtime, session.drawingId, () => updated);
        runtime.emit({
          context,
          data: { kind: 'line-update', drawingId: session.drawingId },
        });
        break;
      }
    }
  }

  private finishInteraction(
    session: LinePointerSession,
    point: { x: number; y: number },
    runtime: DrawToolRuntime,
    context: PointerContext
  ): void {
    if (session.mode === 'create') {
      this.updateActiveLine(session, point, runtime, context);
      let removed = false;
      if (context.type === 'cancel') {
        removed = true;
        this.removeLine(session.drawingId, runtime);
        if (this.selectedId === session.drawingId) {
          this.selectedId = undefined;
          runtime.emit({ context, data: { kind: 'select', target: undefined } });
        }
      } else {
        const start = session.anchor;
        if (distance(start, point) < 0.35) {
          removed = true;
          this.removeLine(session.drawingId, runtime);
          if (this.selectedId === session.drawingId) {
            this.selectedId = undefined;
            runtime.emit({ context, data: { kind: 'select', target: undefined } });
          }
        }
      }
      if (!removed) {
        this.selectedId = session.drawingId;
        runtime.emit({
          context,
          data: {
            kind: 'select',
            target: { type: 'drawing', id: session.drawingId },
          },
        });
      }
      runtime.emit({ context, data: { kind: 'line-end', drawingId: session.drawingId } });
      return;
    }

    if (context.type === 'cancel') {
      this.applyLinePoints(runtime, session.drawingId, () => session.originalPoints);
    } else {
      this.updateActiveLine(session, point, runtime, context);
    }
    runtime.emit({ context, data: { kind: 'line-end', drawingId: session.drawingId } });
  }

  private applyLinePoints(
    runtime: DrawToolRuntime,
    drawingId: string,
    mutate: (drawing: LineDrawing) => Array<{ x: number; y: number }>
  ): void {
    runtime.updateScene((snapshot) => ({
      ...snapshot,
      scene: {
        ...snapshot.scene,
        drawings: snapshot.scene.drawings.map((drawing) => {
          if (drawing.id !== drawingId || drawing.kind !== 'line') {
            return drawing;
          }
          const points = mutate(drawing);
          return {
            ...drawing,
            points,
            meta: touchDrawingMeta(drawing.meta),
          };
        }),
      },
    }));
  }

  private findEditableTarget(
    scene: SceneSnapshot,
    point: { x: number; y: number }
  ):
    | { drawing: LineDrawing; mode: LinePointerSession['mode'] }
    | undefined {
    const selectedId = this.selectedId;
    if (!selectedId) {
      return undefined;
    }
    const drawing = scene.scene.drawings.find(
      (entry): entry is LineDrawing => entry.id === selectedId && entry.kind === 'line'
    );
    if (!drawing) {
      return undefined;
    }
    const { start, end } = getLineEndpoints(drawing.points);
    if (distance(start, point) <= LINE_HANDLE_RADIUS) {
      return { drawing, mode: 'edit-start' };
    }
    if (distance(end, point) <= LINE_HANDLE_RADIUS) {
      return { drawing, mode: 'edit-end' };
    }
    if (this.isPointNearLine(drawing.points, point.x, point.y, drawing.width)) {
      return { drawing, mode: 'edit-move' };
    }
    return undefined;
  }

  private findLineAtPoint(
    drawings: Drawing[],
    point: { x: number; y: number }
  ): LineDrawing | undefined {
    for (let index = drawings.length - 1; index >= 0; index -= 1) {
      const drawing = drawings[index];
      if (drawing.kind !== 'line') {
        continue;
      }
      const { start, end } = getLineEndpoints(drawing.points);
      if (distance(start, point) <= LINE_HANDLE_RADIUS) {
        return drawing;
      }
      if (distance(end, point) <= LINE_HANDLE_RADIUS) {
        return drawing;
      }
      if (this.isPointNearLine(drawing.points, point.x, point.y, drawing.width)) {
        return drawing;
      }
    }
    return undefined;
  }

  private findHoverTarget(
    scene: SceneSnapshot,
    point: { x: number; y: number }
  ): SelectTarget | undefined {
    for (let index = scene.scene.drawings.length - 1; index >= 0; index -= 1) {
      const drawing = scene.scene.drawings[index];
      if (drawing.kind !== 'line') {
        continue;
      }
      const { start, end } = getLineEndpoints(drawing.points);
      if (distance(start, point) <= LINE_HANDLE_RADIUS) {
        return { type: 'drawing', id: drawing.id, handle: 'start' };
      }
      if (distance(end, point) <= LINE_HANDLE_RADIUS) {
        return { type: 'drawing', id: drawing.id, handle: 'end' };
      }
      if (this.isPointNearLine(drawing.points, point.x, point.y, drawing.width)) {
        return { type: 'drawing', id: drawing.id };
      }
    }
    return undefined;
  }

  private isPointNearLine(
    points: Array<{ x: number; y: number }>,
    x: number,
    y: number,
    strokeWidth: number
  ): boolean {
    const threshold = Math.max(LINE_HIT_THRESHOLD, strokeWidth / 2);
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      if (distanceToSegment({ x, y }, from, to) <= threshold) {
        return true;
      }
    }
    return false;
  }

  private removeLine(drawingId: string, runtime: DrawToolRuntime): void {
    runtime.updateScene((snapshot) => ({
      ...snapshot,
      scene: {
        ...snapshot.scene,
        drawings: snapshot.scene.drawings.filter(
          (drawing) => drawing.id !== drawingId
        ),
      },
    }));
  }

  private createDrawingId(pointerId: number): string {
    return `line-${pointerId}-${Date.now()}-${Math.floor(
      Math.random() * 1000
    )}`;
  }

  private isSameTarget(a?: SelectTarget | null, b?: SelectTarget | null): boolean {
    if (!a && !b) {
      return true;
    }
    if (!a || !b) {
      return false;
    }
    if (a.type !== b.type || a.id !== b.id) {
      return false;
    }
    if (a.type === 'drawing' && b.type === 'drawing') {
      return a.handle === b.handle && a.action === b.action;
    }
    return true;
  }
}

class PenTool implements DrawTool {
  readonly id: DrawToolId = 'pen';
  readonly label = 'Pen';
  readonly description = 'Freihand-Linien zeichnen.';

  private readonly activeStrokeIds = new Map<number, string>();
  private readonly lastPoint = new Map<number, { x: number; y: number }>();
  private readonly minDistance = 0.35 * VISUAL_SCALE;
  private stroke = '#f8fafc';
  private width = 2 * VISUAL_SCALE;

  configure(config: unknown): void {
    if (!config || typeof config !== 'object') {
      return;
    }
    const maybe = config as { color?: unknown; width?: unknown };
    if (typeof maybe.color === 'string') {
      this.stroke = maybe.color;
    }
    if (typeof maybe.width === 'number' && Number.isFinite(maybe.width)) {
      this.width = Math.max(0.5, Math.min(maybe.width, 12));
    }
  }

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
              stroke: this.stroke,
              width: this.width,
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
      if (
        last &&
        Math.hypot(next.x - last.x, next.y - last.y) < this.minDistance
      ) {
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
  private color = '#facc15';
  private width = 2.5 * VISUAL_SCALE;
  private selectedId?: string;
  private hovered?: SelectTarget;

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

    if (context.type === 'move' && context.buttons === 0) {
      this.emitHover(context, runtime);
      return;
    }

    if (context.type === 'down') {
      const point = toPoint(context);
      const editable = scene
        ? this.hitTestArrow(
            scene.scene.drawings,
            point.x,
            point.y,
            this.selectedId
          )
        : undefined;
      if (editable) {
        this.selectedId = editable.state.drawingId;
        this.active.set(pointerId, editable.state);
        runtime.emit({
          context,
          data: { kind: 'arrow-start', drawingId: editable.state.drawingId },
        });
        return;
      }

      const candidate = scene
        ? this.hitTestArrow(
            scene.scene.drawings,
            point.x,
            point.y
          )
        : undefined;
      if (candidate) {
        if (this.selectedId !== candidate.state.drawingId) {
          this.selectedId = candidate.state.drawingId;
          runtime.emit({
            context,
            data: {
              kind: 'select',
              target: { type: 'drawing', id: candidate.state.drawingId },
            },
          });
        }
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
              stroke: this.color,
              width: this.width,
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
                  from: {
                    x: state.startFrom.x + dx,
                    y: state.startFrom.y + dy,
                  },
                  to: { x: state.startTo.x + dx, y: state.startTo.y + dy },
                  meta: touchDrawingMeta(drawing.meta),
                };
              }
            }
          }),
        },
      }));
      runtime.emit({
        context,
        data: { kind: 'arrow-update', drawingId: state.drawingId },
      });
      return;
    }

    if (context.type === 'up' || context.type === 'cancel') {
      const state = this.active.get(pointerId);
      if (state) {
        if (context.type !== 'cancel') {
          this.selectedId = state.drawingId;
          runtime.emit({
            context,
            data: {
              kind: 'select',
              target: { type: 'drawing', id: state.drawingId },
            },
          });
        }
        runtime.emit({
          context,
          data: { kind: 'arrow-end', drawingId: state.drawingId },
        });
      }
      this.active.delete(pointerId);
    }
  }

  private hitTestArrow(
    drawings: Drawing[],
    x: number,
    y: number,
    restrictToId?: string
  ):
    | {
        drawing: Drawing & { kind: 'arrow' };
        state: {
          drawingId: string;
          mode: 'edit-to' | 'edit-from' | 'edit-move';
          startPointer?: { x: number; y: number };
          startFrom?: { x: number; y: number };
          startTo?: { x: number; y: number };
        };
      }
    | undefined {
    const selectedOnly = Boolean(restrictToId);
    const selectedId = restrictToId ?? this.selectedId;
    for (let i = drawings.length - 1; i >= 0; i -= 1) {
      const drawing = drawings[i];
      if (drawing.kind !== 'arrow') {
        continue;
      }
      if (selectedOnly && selectedId && drawing.id !== selectedId) {
        continue;
      }
      if (selectedOnly && !selectedId) {
        return undefined;
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
    return `arrow-${pointerId}-${Date.now()}-${Math.floor(
      Math.random() * 1000
    )}`;
  }

  configure(config: unknown): void {
    if (!config || typeof config !== 'object') {
      return;
    }
    const maybe = config as { color?: unknown; width?: unknown };
    if (typeof maybe.color === 'string') {
      this.color = maybe.color;
    }
    if (typeof maybe.width === 'number' && Number.isFinite(maybe.width)) {
      this.width = Math.max(0.5, Math.min(maybe.width, 12));
    }
  }

  private emitHover(context: PointerContext, runtime: DrawToolRuntime): void {
    const scene = runtime.scene;
    if (!scene) {
      return;
    }
    const hit = this.hitTestArrow(
      scene.scene.drawings,
      context.fieldPoint.x,
      context.fieldPoint.y
    );
    let target: SelectTarget | undefined;
    if (hit) {
      if (hit.state.mode === 'edit-from') {
        target = { type: 'drawing', id: hit.state.drawingId, handle: 'start' };
      } else if (hit.state.mode === 'edit-to') {
        target = { type: 'drawing', id: hit.state.drawingId, handle: 'end' };
      } else {
        target = { type: 'drawing', id: hit.state.drawingId };
      }
    }
    if (!this.isSameTarget(target, this.hovered)) {
      this.hovered = target ?? undefined;
      runtime.emit({ context, data: { kind: 'hover', target } });
    }
  }

  private isSameTarget(
    a: SelectTarget | undefined,
    b: SelectTarget | undefined
  ): boolean {
    if (!a && !b) {
      return true;
    }
    if (!a || !b) {
      return false;
    }
    if (a.type !== b.type || a.id !== b.id) {
      return false;
    }
    if (a.type === 'drawing' && b.type === 'drawing') {
      const handleA = 'handle' in a ? a.handle : undefined;
      const handleB = 'handle' in b ? b.handle : undefined;
      const actionA = 'action' in a ? a.action : undefined;
      const actionB = 'action' in b ? b.action : undefined;
      return handleA === handleB && actionA === actionB;
    }
    return true;
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
      const existing = scene
        ? this.hitTestCone(
            scene.scene.drawings,
            context.fieldPoint.x,
            context.fieldPoint.y
          )
        : undefined;
      if (existing) {
        this.active.set(pointerId, existing.state);
        runtime.emit({
          context,
          data: { kind: 'cone-start', drawingId: existing.state.drawingId },
        });
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
              radius: 2 * VISUAL_SCALE,
              fill: 'rgba(34, 197, 94, 0.35)',
              meta: newDrawingMeta(),
            },
          ],
        },
      }));
      runtime.emit({
        context,
        data: {
          kind: 'select',
          target: { type: 'drawing', id: drawingId },
        },
      });
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
            const radius = Math.max(
              0.5,
              Math.hypot(current.x - origin.x, current.y - origin.y)
            );
            return {
              ...drawing,
              radius,
              meta: touchDrawingMeta(drawing.meta),
            };
          }),
        },
      }));
      runtime.emit({
        context,
        data: { kind: 'cone-update', drawingId: state.drawingId },
      });
      return;
    }

    if (context.type === 'up' || context.type === 'cancel') {
      const state = this.active.get(pointerId);
      if (state) {
        runtime.emit({
          context,
          data: { kind: 'cone-end', drawingId: state.drawingId },
        });
      }
      this.active.delete(pointerId);
    }
  }

  private hitTestCone(
    drawings: Drawing[],
    x: number,
    y: number
  ):
    | {
        drawing: Drawing & { kind: 'cone' };
        state: {
          drawingId: string;
          mode: 'resize' | 'move';
          origin?: { x: number; y: number };
          pointerOffset?: { dx: number; dy: number };
        };
      }
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
    return `cone-${pointerId}-${Date.now()}-${Math.floor(
      Math.random() * 1000
    )}`;
  }
}

class EraserTool implements DrawTool {
  readonly id: DrawToolId = 'eraser';
  readonly label = 'Eraser';
  readonly description = 'Zeichnungen entfernen.';
  private radius = 3.2 * VISUAL_SCALE;

  configure(config: unknown): void {
    if (!config || typeof config !== 'object') {
      return;
    }
    const maybe = config as { radius?: unknown };
    if (typeof maybe.radius === 'number' && Number.isFinite(maybe.radius)) {
      this.radius = Math.max(1, Math.min(maybe.radius, 12));
    }
  }

  handlePointer(context: PointerContext, runtime: DrawToolRuntime): void {
    if (!runtime.scene) {
      return;
    }
    if (
      context.type !== 'down' &&
      !(context.type === 'move' && context.buttons > 0)
    ) {
      return;
    }
    const point = { x: context.fieldPoint.x, y: context.fieldPoint.y };
    const erased = this.eraseAtPoint(point, runtime);
    if (erased) {
      runtime.emit({ context, data: { kind: 'erase' } });
    }
  }

  private eraseAtPoint(
    point: { x: number; y: number },
    runtime: DrawToolRuntime
  ): boolean {
    let changed = false;
    runtime.updateScene((snapshot) => {
      const nextDrawings: Drawing[] = [];
      snapshot.scene.drawings.forEach((drawing) => {
        const segments = this.eraseDrawing(drawing, point);
        if (segments.length !== 1 || segments[0] !== drawing) {
          changed = true;
        }
        segments.forEach((segment) => nextDrawings.push(segment));
      });
      if (!changed) {
        return snapshot;
      }
      return {
        ...snapshot,
        scene: {
          ...snapshot.scene,
          drawings: nextDrawings,
        },
      };
    });
    return changed;
  }

  private eraseDrawing(
    drawing: Drawing,
    point: { x: number; y: number }
  ): Drawing[] {
    if (drawing.kind === 'pen') {
      return this.trimPenDrawing(drawing, point);
    }
    return [drawing];
  }

  private trimPenDrawing(
    drawing: Drawing & { kind: 'pen' },
    point: { x: number; y: number }
  ): Drawing[] {
    const threshold = this.radius + drawing.width / 2;
    const segments = this.clipPolylineByCircle(
      drawing.points,
      point,
      threshold
    );
    if (segments.length === 0) {
      return [];
    }
    if (
      segments.length === 1 &&
      this.segmentsMatchOriginal(segments[0], drawing.points)
    ) {
      return [drawing];
    }

    const timestamp = Date.now();
    return segments.map((pts, index) => ({
      ...drawing,
      id: `${drawing.id}-split-${timestamp}-${index}-${Math.floor(
        Math.random() * 1000
      )}`,
      points: pts,
      meta: touchDrawingMeta(drawing.meta),
    }));
  }

  private trimArrowDrawing(
    drawing: Drawing & { kind: 'arrow' },
    point: { x: number; y: number }
  ): Drawing[] {
    const threshold = this.radius + drawing.width / 2;
    const segments = this.clipSegmentOutsideCircle(
      drawing.from,
      drawing.to,
      point,
      threshold
    );
    if (segments.length === 0) {
      return [];
    }
    let best = segments[0];
    let bestLength = Math.hypot(
      best.to.x - best.from.x,
      best.to.y - best.from.y
    );
    for (let index = 1; index < segments.length; index += 1) {
      const candidate = segments[index];
      const candidateLength = Math.hypot(
        candidate.to.x - candidate.from.x,
        candidate.to.y - candidate.from.y
      );
      if (candidateLength > bestLength) {
        best = candidate;
        bestLength = candidateLength;
      }
    }
    if (bestLength <= 0.5) {
      return [];
    }
    return [
      {
        ...drawing,
        from: best.from,
        to: best.to,
        meta: touchDrawingMeta(drawing.meta),
      },
    ];
  }

  private trimLineDrawing(
    drawing: Drawing & { kind: 'line' },
    point: { x: number; y: number }
  ): Drawing[] {
    const threshold = this.radius + drawing.width / 2;
    const segments = this.clipPolylineByCircle(
      drawing.points,
      point,
      threshold
    );
    if (segments.length === 0) {
      return [];
    }
    if (
      segments.length === 1 &&
      this.segmentsMatchOriginal(segments[0], drawing.points)
    ) {
      return [drawing];
    }
    const timestamp = Date.now();
    return segments.map((pts, index) => ({
      ...drawing,
      id: `${drawing.id}-split-${timestamp}-${index}-${Math.floor(
        Math.random() * 1000
      )}`,
      points: pts,
      meta: touchDrawingMeta(drawing.meta),
    }));
  }

  private segmentsMatchOriginal(
    segment: Array<{ x: number; y: number }>,
    original: Array<{ x: number; y: number }>
  ): boolean {
    if (segment.length !== original.length) {
      return false;
    }
    return segment.every((point, index) => {
      const other = original[index];
      return (
        Math.abs(point.x - other.x) < 1e-6 && Math.abs(point.y - other.y) < 1e-6
      );
    });
  }

  private clipPolylineByCircle(
    points: Array<{ x: number; y: number }>,
    center: { x: number; y: number },
    radius: number
  ): Array<Array<{ x: number; y: number }>> {
    if (points.length < 2) {
      return [];
    }
    const result: Array<Array<{ x: number; y: number }>> = [];
    let current: Array<{ x: number; y: number }> | null = null;

    const pushCurrent = () => {
      if (current && current.length > 1) {
        result.push(current);
      }
      current = null;
    };

    const addPoint = (point: { x: number; y: number }) => {
      if (!current) {
        current = [];
      }
      const last = current[current.length - 1];
      if (
        !last ||
        Math.abs(last.x - point.x) >= 1e-6 ||
        Math.abs(last.y - point.y) >= 1e-6
      ) {
        current.push(point);
      }
    };

    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      const segments = this.clipSegmentOutsideCircle(
        start,
        end,
        center,
        radius
      );
      if (segments.length === 0) {
        pushCurrent();
        continue;
      }
      segments.forEach((segment, segmentIndex) => {
        addPoint(segment.from);
        addPoint(segment.to);
        if (segmentIndex < segments.length - 1) {
          pushCurrent();
        }
      });
    }

    pushCurrent();
    return result;
  }

  private clipSegmentOutsideCircle(
    start: { x: number; y: number },
    end: { x: number; y: number },
    center: { x: number; y: number },
    radius: number
  ): Array<{ from: { x: number; y: number }; to: { x: number; y: number } }> {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const a = dx * dx + dy * dy;
    if (a < 1e-9) {
      return [];
    }
    const intersections = this.segmentCircleIntersections(
      start,
      end,
      center,
      radius
    );
    const tValues = [
      0,
      ...intersections.map((value) => value.t).sort((a, b) => a - b),
      1,
    ];
    const segments: Array<{
      from: { x: number; y: number };
      to: { x: number; y: number };
    }> = [];

    for (let index = 0; index < tValues.length - 1; index += 1) {
      const t0 = tValues[index];
      const t1 = tValues[index + 1];
      if (t1 - t0 < 1e-6) {
        continue;
      }
      const midT = (t0 + t1) / 2;
      const midPoint = {
        x: start.x + dx * midT,
        y: start.y + dy * midT,
      };
      if (distance(midPoint, center) > radius) {
        const fromPoint = {
          x: start.x + dx * t0,
          y: start.y + dy * t0,
        };
        const toPoint = {
          x: start.x + dx * t1,
          y: start.y + dy * t1,
        };
        if (distance(fromPoint, toPoint) > 1e-4) {
          segments.push({ from: fromPoint, to: toPoint });
        }
      }
    }

    return segments;
  }

  private segmentCircleIntersections(
    start: { x: number; y: number },
    end: { x: number; y: number },
    center: { x: number; y: number },
    radius: number
  ): Array<{ t: number; point: { x: number; y: number } }> {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const fx = start.x - center.x;
    const fy = start.y - center.y;

    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - radius * radius;

    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) {
      return [];
    }
    const sqrt = Math.sqrt(discriminant);
    const t1 = (-b - sqrt) / (2 * a);
    const t2 = (-b + sqrt) / (2 * a);
    const intersections: Array<{ t: number; point: { x: number; y: number } }> =
      [];
    if (t1 >= 0 && t1 <= 1) {
      intersections.push({
        t: t1,
        point: { x: start.x + dx * t1, y: start.y + dy * t1 },
      });
    }
    if (t2 >= 0 && t2 <= 1 && Math.abs(t2 - t1) > 1e-6) {
      intersections.push({
        t: t2,
        point: { x: start.x + dx * t2, y: start.y + dy * t2 },
      });
    }
    return intersections;
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

function distance(
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isPointInsideImage(
  drawing: Drawing & { kind: 'image' },
  x: number,
  y: number
): boolean {
  return (
    x >= drawing.x &&
    x <= drawing.x + drawing.width &&
    y >= drawing.y &&
    y <= drawing.y + drawing.height
  );
}

function distanceToSegment(
  point: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = point.x - a.x;
  const apy = point.y - a.y;
  const abLenSq = abx * abx + aby * aby;
  const t =
    abLenSq !== 0
      ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq))
      : 0;
  const closestX = a.x + abx * t;
  const closestY = a.y + aby * t;
  return Math.hypot(point.x - closestX, point.y - closestY);
}

function projectPointOntoSegment(
  point: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): { closest: { x: number; y: number }; t: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = point.x - a.x;
  const apy = point.y - a.y;
  const abLenSq = abx * abx + aby * aby;
  const t =
    abLenSq !== 0
      ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq))
      : 0;
  return {
    closest: {
      x: a.x + abx * t,
      y: a.y + aby * t,
    },
    t,
  };
}

export function getLineEndpoints(points: Array<{ x: number; y: number }>): {
  start: { x: number; y: number };
  end: { x: number; y: number };
} {
  const start = points[0] ?? { x: 0, y: 0 };
  const end = points.length > 1 ? points[points.length - 1] : start;
  return { start, end };
}

export function getLineMidpoint(points: Array<{ x: number; y: number }>): {
  x: number;
  y: number;
} {
  const { start, end } = getLineEndpoints(points);
  return {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  };
}
