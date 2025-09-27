import type { SceneSnapshot, Team } from '@juggertools/core-domain';
import { createSceneSnapshot, nowISO } from '@juggertools/core-domain';
import {
  composeTransforms,
  IDENTITY_MATRIX,
  matrixApplyToPoint,
  matrixInvert,
  matrixMultiply,
  matrixScale,
  matrixTranslate,
  Matrix2D,
  PointLike,
} from '@juggertools/core-geometry';

export type PointerEventType = 'down' | 'move' | 'up' | 'cancel';

export type LayerId = 'background' | 'drawings' | 'tokens' | 'overlay';

export interface EngineViewport {
  width: number;
  height: number;
}

export interface RenderState {
  scene?: SceneSnapshot;
  fieldToCanvas: Matrix2D;
  canvasToField: Matrix2D;
  devicePixelRatio: number;
  viewport: EngineViewport;
  timestamp: number;
}

export interface CanvasFormLine {
  points: PointLike[];
  stroke?: string;
  width?: number;
  dash?: number[];
  opacity?: number;
  closePath?: boolean;
  fill?: string;
  coordinateSpace?: 'absolute' | 'relative';
}

export type LayerRenderer = (ctx: CanvasRenderingContext2D, state: RenderState) => void;

export interface CanvasEngineOptions {
  devicePixelRatio?: number;
  viewport?: EngineViewport;
  layers?: LayerId[];
}

export interface PointerContext {
  type: PointerEventType;
  originalEvent: PointerEvent;
  canvasPoint: PointLike;
  fieldPoint: PointLike;
  buttons: number;
}

type PointerHandler = (context: PointerContext) => void;

type PointerHandlerRegistry = Record<PointerEventType, Set<PointerHandler>>;

export class CanvasEngine {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layerOrder: LayerId[];
  private readonly layerRenderers = new Map<LayerId, Set<LayerRenderer>>();
  private readonly pointerHandlers: PointerHandlerRegistry = {
    down: new Set(),
    move: new Set(),
    up: new Set(),
    cancel: new Set(),
  };

  private scene?: SceneSnapshot;
  private viewport: EngineViewport;
  private fieldToCanvas: Matrix2D = IDENTITY_MATRIX;
  private canvasToField: Matrix2D = IDENTITY_MATRIX;
  private transformMode: 'auto' | 'custom' = 'auto';
  private dpr: number;
  private rafHandle: number | null = null;
  private destroyed = false;
  private formLines: CanvasFormLine[] = [];

  constructor(canvas: HTMLCanvasElement, options: CanvasEngineOptions = {}) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable.');
    }

    this.canvas = canvas;
    this.ctx = ctx;
    this.dpr = options.devicePixelRatio ?? globalThis.devicePixelRatio ?? 1;
    this.viewport = options.viewport ?? {
      width: canvas.clientWidth || canvas.width || 0,
      height: canvas.clientHeight || canvas.height || 0,
    };
    this.layerOrder = options.layers ?? ['background', 'drawings', 'tokens', 'overlay'];

    for (const layer of this.layerOrder) {
      this.layerRenderers.set(layer, new Set());
    }

    this.resize(this.viewport.width, this.viewport.height);
    if (!this.scene) {
      this.initializeDefaultScene();
    }
    this.attachPointerListeners();
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.detachPointerListeners();
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.layerRenderers.clear();
  }

  setScene(scene: SceneSnapshot | undefined): void {
    this.scene = scene;
    if (scene && this.transformMode === 'auto') {
      this.computeFitTransform();
    } else {
      this.scheduleDraw();
    }
  }

  getScene(): SceneSnapshot | undefined {
    return this.scene;
  }

  private applyTransform(matrix: Matrix2D, mode: 'auto' | 'custom'): void {
    const scaled = composeTransforms([matrixScale(this.dpr), matrix]);
    this.fieldToCanvas = scaled;
    this.canvasToField = matrixInvert(scaled);
    this.transformMode = mode;
    this.scheduleDraw();
  }

  setTransform(matrix: Matrix2D): void {
    this.applyTransform(matrix, 'custom');
  }

  getTransform(): Matrix2D {
    return this.fieldToCanvas;
  }

  getViewport(): EngineViewport {
    return { ...this.viewport };
  }

  drawForm(lines: readonly CanvasFormLine[]): void {
    this.formLines = lines.map((line) => ({
      ...line,
      points: line.points.map((point) => ({ ...point })),
      dash: line.dash ? [...line.dash] : undefined,
    }));
    this.scheduleDraw();
  }

  clearForm(): void {
    if (this.formLines.length === 0) {
      return;
    }
    this.formLines = [];
    this.scheduleDraw();
  }

  resize(width: number, height: number): void {
    this.viewport = { width, height };
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.canvas.width = Math.max(1, Math.floor(width * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(height * this.dpr));
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.scene && this.transformMode === 'auto') {
      this.computeFitTransform();
    } else {
      this.scheduleDraw();
    }
  }

  registerLayerRenderer(layer: LayerId, renderer: LayerRenderer): () => void {
    const registry = this.layerRenderers.get(layer);
    if (!registry) {
      throw new Error(`Unknown layer: ${layer}`);
    }
    registry.add(renderer);
    this.scheduleDraw();
    return () => {
      registry.delete(renderer);
      this.scheduleDraw();
    };
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(timestamp = performance.now()): void {
    if (this.destroyed) {
      return;
    }

    this.ctx.save();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const state: RenderState = {
      scene: this.scene,
      fieldToCanvas: this.fieldToCanvas,
      canvasToField: this.canvasToField,
      devicePixelRatio: this.dpr,
      viewport: this.viewport,
      timestamp,
    };

    this.renderFormLines(state);

    for (const layer of this.layerOrder) {
      const renderers = this.layerRenderers.get(layer);
      if (!renderers || renderers.size === 0) {
        continue;
      }
      this.ctx.save();
      this.ctx.setTransform(
        this.fieldToCanvas.a,
        this.fieldToCanvas.b,
        this.fieldToCanvas.c,
        this.fieldToCanvas.d,
        this.fieldToCanvas.tx,
        this.fieldToCanvas.ty,
      );
      for (const renderer of renderers) {
        renderer(this.ctx, state);
      }
      this.ctx.restore();
    }

    this.ctx.restore();
  }

  private renderFormLines(_state: RenderState): void {
    if (this.formLines.length === 0) {
      return;
    }

    this.ctx.save();
    this.ctx.setTransform(
      this.fieldToCanvas.a,
      this.fieldToCanvas.b,
      this.fieldToCanvas.c,
      this.fieldToCanvas.d,
      this.fieldToCanvas.tx,
      this.fieldToCanvas.ty,
    );

    this.formLines.forEach((line) => {
      if (line.points.length === 0) {
        return;
      }

      this.ctx.save();
      if (line.opacity !== undefined) {
        this.ctx.globalAlpha = line.opacity;
      }
      if (line.stroke) {
        this.ctx.strokeStyle = line.stroke;
      }

      const points = line.coordinateSpace === 'relative'
        ? line.points.map((point) => ({
            x: (point.x / 100) * this.viewport.width,
            y: (point.y / 100) * this.viewport.height,
          }))
        : line.points;

      const width = line.width !== undefined
        ? line.coordinateSpace === 'relative'
          ? (line.width / 100) * this.viewport.height
          : line.width
        : undefined;
      if (width !== undefined) {
        this.ctx.lineWidth = width;
      }

      const dash = line.dash
        ? line.coordinateSpace === 'relative'
          ? line.dash.map((value) => (value / 100) * this.viewport.height)
          : line.dash
        : undefined;
      this.ctx.setLineDash(dash ?? []);
      this.ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) {
          this.ctx.moveTo(point.x, point.y);
        } else {
          this.ctx.lineTo(point.x, point.y);
        }
      });
      if (line.closePath) {
        this.ctx.closePath();
      }
      const hasFill = typeof line.fill === 'string';
      if (hasFill) {
        this.ctx.fillStyle = line.fill!;
        this.ctx.fill();
      }
      if (line.stroke !== undefined || !hasFill) {
        this.ctx.stroke();
      }
      this.ctx.restore();
    });

    this.ctx.restore();
  }

  private initializeDefaultScene(): void {
    const defaultTeam = (id: string, name: string, color: string): Team => ({
      id,
      name,
      color,
      players: [],
    });
    const scene = createSceneSnapshot({
      id: `engine-${nowISO()}`,
      field: {
        width: this.viewport.width,
        height: this.viewport.height,
        lines: [],
      },
      leftTeam: defaultTeam('engine-left', 'Left', '#f87171'),
      rightTeam: defaultTeam('engine-right', 'Right', '#60a5fa'),
    });
    this.setScene(scene);
  }

  scheduleDraw(): void {
    if (this.rafHandle !== null) {
      return;
    }
    this.rafHandle = requestAnimationFrame((ts) => {
      this.rafHandle = null;
      this.draw(ts);
    });
  }

  screenToField(clientX: number, clientY: number): PointLike {
    const rect = this.canvas.getBoundingClientRect();
    const canvasPoint = {
      x: (clientX - rect.left) * this.dpr,
      y: (clientY - rect.top) * this.dpr,
    };
    return matrixApplyToPoint(this.canvasToField, canvasPoint);
  }

  fieldToScreen(point: PointLike): PointLike {
    const canvasPoint = matrixApplyToPoint(this.fieldToCanvas, point);
    return {
      x: canvasPoint.x / this.dpr,
      y: canvasPoint.y / this.dpr,
    };
  }

  onPointer(type: PointerEventType, handler: PointerHandler): () => void {
    const set = this.pointerHandlers[type];
    set.add(handler);
    return () => set.delete(handler);
  }

  private attachPointerListeners(): void {
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('pointercancel', this.handlePointerCancel);
  }

  private detachPointerListeners(): void {
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointercancel', this.handlePointerCancel);
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    this.dispatchPointer('down', event);
  };

  private readonly handlePointerMove = (event: PointerEvent) => {
    this.dispatchPointer('move', event);
  };

  private readonly handlePointerUp = (event: PointerEvent) => {
    this.dispatchPointer('up', event);
  };

  private readonly handlePointerCancel = (event: PointerEvent) => {
    this.dispatchPointer('cancel', event);
  };

  private dispatchPointer(type: PointerEventType, event: PointerEvent): void {
    const handlers = this.pointerHandlers[type];
    if (!handlers || handlers.size === 0) {
      return;
    }
    const fieldPoint = this.screenToField(event.clientX, event.clientY);
    const rect = this.canvas.getBoundingClientRect();
    const canvasPoint = {
      x: (event.clientX - rect.left) * this.dpr,
      y: (event.clientY - rect.top) * this.dpr,
    };

    const context: PointerContext = {
      type,
      originalEvent: event,
      canvasPoint,
      fieldPoint,
      buttons: event.buttons,
    };

    handlers.forEach((handler) => handler(context));
  }

  private computeFitTransform(): void {
    if (!this.scene) {
      return;
    }

    const { field, orientation } = this.scene.scene;
    const effectiveWidth = orientation === 'portrait' ? field.height : field.width;
    const effectiveHeight = orientation === 'portrait' ? field.width : field.height;

    const scale = this.autoscale(effectiveWidth, effectiveHeight, this.viewport.width, this.viewport.height);

    const centerOffset = matrixTranslate(
      (this.viewport.width - effectiveWidth * scale) / 2,
      (this.viewport.height - effectiveHeight * scale) / 2,
    );

    const scaleMatrix = matrixScale(scale);

    let orientationMatrix: Matrix2D = IDENTITY_MATRIX;

    if (orientation === 'portrait') {
      // Rotate 90° clockwise around the origin and shift to keep the scene in the positive quadrant.
      const rotate = { a: 0, b: 1, c: -1, d: 0, tx: 0, ty: 0 };
      const translate = matrixTranslate(field.height, 0);
      orientationMatrix = matrixMultiply(translate, rotate);
    }

    const transform = composeTransforms([centerOffset, scaleMatrix, orientationMatrix]);
    this.applyTransform(transform, 'auto');
  }

  autoFitScene(): void {
    this.transformMode = 'auto';
    if (this.scene) {
      this.computeFitTransform();
    } else {
      this.scheduleDraw();
    }
  }

  private autoscale(srcWidth: number, srcHeight: number, dstWidth: number, dstHeight: number): number {
    if (srcWidth === 0 || srcHeight === 0) {
      return 1;
    }
    const scaleX = dstWidth / srcWidth;
    const scaleY = dstHeight / srcHeight;
    return Math.min(scaleX, scaleY);
  }
}

export function fitSceneToViewport(
  scene: SceneSnapshot,
  viewport: EngineViewport,
  options?: { padding?: number },
): Matrix2D {
  const padding = Math.max(0, options?.padding ?? 0);
  const paddedViewport = {
    width: Math.max(1, viewport.width - padding * 2),
    height: Math.max(1, viewport.height - padding * 2),
  };

  const width = scene.scene.orientation === 'portrait' ? scene.scene.field.height : scene.scene.field.width;
  const height = scene.scene.orientation === 'portrait' ? scene.scene.field.width : scene.scene.field.height;

  const scaleX = paddedViewport.width / width;
  const scaleY = paddedViewport.height / height;
  const scale = Math.min(scaleX, scaleY);

  const offset = matrixTranslate(padding + (paddedViewport.width - width * scale) / 2, padding + (paddedViewport.height - height * scale) / 2);
  const scaleMatrix = matrixScale(scale);

  let orientationMatrix: Matrix2D = IDENTITY_MATRIX;
  if (scene.scene.orientation === 'portrait') {
    const rotate = { a: 0, b: 1, c: -1, d: 0, tx: 0, ty: 0 };
    const translate = matrixTranslate(scene.scene.field.height, 0);
    orientationMatrix = matrixMultiply(translate, rotate);
  }

  return composeTransforms([offset, scaleMatrix, orientationMatrix]);
}
