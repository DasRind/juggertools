import { TestBed } from '@angular/core/testing';
import { App } from './app';
import type { CanvasEngine } from '@juggertools/core-engine';

class ResizeObserverStub {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    this.callback(
      [
        {
          contentRect: { width: 640, height: 360 },
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}

describe('App', () => {
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
  let originalCreateObjectUrl: ((...args: any[]) => string) | undefined;
  let originalRevokeObjectUrl: ((...args: any[]) => void) | undefined;

  beforeAll(() => {
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    originalCreateObjectUrl = (URL as any).createObjectURL;
    originalRevokeObjectUrl = (URL as any).revokeObjectURL;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: jest.fn(() => 'blob:url'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: jest.fn(() => undefined),
    });
  });

  beforeEach(async () => {
    localStorage.clear();
    (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
    (globalThis as any).cancelAnimationFrame = () => {};

    if (typeof (globalThis as any).PointerEvent === 'undefined') {
      (globalThis as any).PointerEvent = MouseEvent as unknown as typeof PointerEvent;
    }

    (globalThis as any).ResizeObserver = ResizeObserverStub;

    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: jest.fn(() => ({
        setTransform: jest.fn(),
        clearRect: jest.fn(),
        save: jest.fn(),
        restore: jest.fn(),
        beginPath: jest.fn(),
        moveTo: jest.fn(),
        lineTo: jest.fn(),
        stroke: jest.fn(),
        fillRect: jest.fn(),
        fill: jest.fn(),
        arc: jest.fn(),
        fillText: jest.fn(),
        font: '',
        lineJoin: 'round',
        lineCap: 'round',
      } as unknown as CanvasRenderingContext2D)),
    });

    jest
      .spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({
        left: 0,
        top: 0,
        right: 640,
        bottom: 360,
        width: 640,
        height: 360,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect);

    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    localStorage.clear();
  });

  afterAll(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: originalGetContext,
    });
    if (originalCreateObjectUrl) {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: originalCreateObjectUrl,
      });
    } else {
      delete (URL as any).createObjectURL;
    }
    if (originalRevokeObjectUrl) {
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: originalRevokeObjectUrl,
      });
    } else {
      delete (URL as any).revokeObjectURL;
    }
  });

  it('renders team panels and default tools', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    const headings = Array.from(compiled.querySelectorAll('h2')).map((el) => el.textContent?.trim());
    expect(headings).toEqual(expect.arrayContaining(['Red Ravens', 'Azure Titans']));

    const toolButtons = Array.from(compiled.querySelectorAll('.tool-button')).map((el) => el.textContent?.trim());
    expect(toolButtons).toEqual(expect.arrayContaining(['Select', 'Line', 'Pen', 'Arrow', 'Cone', 'Eraser']));

    const actionButtons = Array.from(compiled.querySelectorAll('.field-area__actions button')).map((el) => el.textContent?.trim());
    expect(actionButtons.some((text) => (text ?? '').includes('Undo'))).toBe(true);
    expect(actionButtons.some((text) => (text ?? '').includes('Redo'))).toBe(true);
    expect(actionButtons.some((text) => (text ?? '').includes('Export PNG'))).toBe(true);

    fixture.destroy();
  });

  it('drops a player onto the field and creates a token', () => {
    const fixture = TestBed.createComponent(App);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    const cleanup = jest.fn();
    const engineStub = {
      registerLayerRenderer: jest.fn(() => cleanup),
      screenToField: jest.fn(() => ({ x: 12, y: 18 })),
    } as unknown as CanvasEngine;

    component.handleEngineReady(engineStub);

    const dataTransfer = {
      dropEffect: '',
      effectAllowed: '',
      setData: jest.fn(),
      getData: jest.fn(() => JSON.stringify({ playerId: 'left-1', teamId: 'team-left' })),
    } as unknown as DataTransfer;

    const dropEvent = {
      preventDefault: jest.fn(),
      dataTransfer,
      clientX: 150,
      clientY: 200,
    } as unknown as DragEvent;

    component.handleDrop(dropEvent);

    const tokens = component.scene().scene.tokens;
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ playerId: 'left-1', teamId: 'team-left', x: 12, y: 18 });
    expect(component.selectedTokenId()).toBe(tokens[0].id);

    fixture.destroy();
  });
});
