import type { SceneSnapshot } from '@juggertools/core-domain';
import {
  composeTransforms,
  IDENTITY_MATRIX,
  matrixScale,
  matrixTranslate,
} from '@juggertools/core-geometry';
import { CanvasEngine, fitSceneToViewport } from './core-engine';

type MockCtx = Pick<CanvasRenderingContext2D, 'setTransform' | 'clearRect' | 'save' | 'restore'>;

const createCanvasWithContext = () => {
  const canvas = document.createElement('canvas');
  const ctx: MockCtx = {
    setTransform: jest.fn(),
    clearRect: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
  };

  Object.defineProperty(canvas, 'getContext', {
    value: jest.fn(() => ctx),
  });

  return { canvas, ctx };
};

describe('CanvasEngine', () => {
  beforeEach(() => {
    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
    (globalThis as any).cancelAnimationFrame = () => {};

    if (typeof (globalThis as any).PointerEvent === 'undefined') {
      (globalThis as any).PointerEvent = MouseEvent as unknown as typeof PointerEvent;
    }
  });

  it('resizes canvas according to device pixel ratio', () => {
    const { canvas } = createCanvasWithContext();
    Object.defineProperty(canvas, 'clientWidth', { value: 200, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 100, configurable: true });

    const engine = new CanvasEngine(canvas, { devicePixelRatio: 2 });

    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(200);

    engine.resize(300, 150);
    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(300);
  });

  it('translates screen coordinates to field coordinates', () => {
    const { canvas } = createCanvasWithContext();
    const engine = new CanvasEngine(canvas, { devicePixelRatio: 1 });

    jest.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    const transform = composeTransforms([matrixTranslate(10, 20), matrixScale(2)]);
    engine.setTransform(transform);

    const point = engine.screenToField(30, 40);
    expect(point.x).toBeCloseTo(10);
    expect(point.y).toBeCloseTo(10);
  });

  it('dispatches pointer events with converted coordinates', () => {
    const { canvas } = createCanvasWithContext();
    const engine = new CanvasEngine(canvas, { devicePixelRatio: 1 });

    jest.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 50,
      top: 100,
      right: 250,
      bottom: 300,
      width: 200,
      height: 200,
      x: 50,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect);

    engine.setTransform(IDENTITY_MATRIX);

    const handler = jest.fn();
    engine.onPointer('down', handler);

    const event = new PointerEvent('pointerdown', { clientX: 150, clientY: 200, buttons: 1 });
    canvas.dispatchEvent(event);

    expect(handler).toHaveBeenCalledTimes(1);
    const context = handler.mock.calls[0][0];
    expect(context.type).toBe('down');
    expect(context.canvasPoint).toEqual({ x: 100, y: 100 });
    expect(context.fieldPoint).toEqual({ x: 100, y: 100 });
  });
});

describe('fitSceneToViewport', () => {
  const scene: SceneSnapshot = {
    scene: {
      id: 'scene-1',
      field: { width: 100, height: 50 },
      orientation: 'landscape',
      tokens: [],
      drawings: [],
      leftTeamId: 'left',
      rightTeamId: 'right',
      lastUpdatedAt: new Date().toISOString(),
    },
    leftTeam: { id: 'left', name: 'Left', color: '#f00', players: [] },
    rightTeam: { id: 'right', name: 'Right', color: '#0f0', players: [] },
  };

  beforeEach(() => {
    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
    (globalThis as any).cancelAnimationFrame = () => {};
  });

  it('returns a transform that fits the field into the viewport with padding', () => {
    const transform = fitSceneToViewport(scene, { width: 200, height: 200 }, { padding: 10 });
    expect(transform.a).toBeCloseTo(1.8);
    expect(transform.d).toBeCloseTo(1.8);
    expect(transform.tx).toBeCloseTo(10);
    expect(transform.ty).toBeCloseTo(55);
  });
});
