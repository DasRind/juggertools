import { createSceneSnapshot, Team } from '@juggertools/core-domain';
import type { PointerContext } from '@juggertools/core-engine';
import { DrawToolEvent, DrawToolId, DrawToolRegistry } from './draw-tool-registry';

describe('DrawToolRegistry', () => {
  beforeAll(() => {
    if (typeof (globalThis as any).PointerEvent === 'undefined') {
      (globalThis as any).PointerEvent = MouseEvent as unknown as typeof PointerEvent;
    }
  });

  const makePointerContext = (overrides: Partial<PointerContext>): PointerContext => ({
    type: 'move',
    buttons: 0,
    canvasPoint: { x: 0, y: 0 },
    fieldPoint: { x: 0, y: 0 },
    originalEvent: { pointerId: 1 } as PointerEvent,
    ...overrides,
  });

  const leftTeam: Team = { id: 'left', name: 'Left', color: '#f00', players: [] };
  const rightTeam: Team = { id: 'right', name: 'Right', color: '#0f0', players: [] };

  it('exposes the default tool set', () => {
    const registry = new DrawToolRegistry();
    const toolIds = registry.listTools().map((tool) => tool.id);
    expect(toolIds).toEqual(['select', 'pen', 'arrow', 'cone', 'eraser']);
  });

  it('select tool emits hover/select events and updates token positions', () => {
    let scene = createSceneSnapshot({
      id: 'scene',
      field: { width: 80, height: 50 },
      leftTeam,
      rightTeam,
      tokens: [
        {
          id: 'token-1',
          teamId: 'left',
          playerId: 'p1',
          x: 10,
          y: 10,
        },
      ],
    });

    const events: DrawToolEvent[] = [];
    const registry = new DrawToolRegistry({
      onEvent: (event) => events.push(event),
      applySceneUpdate: (mutator) => {
        scene = mutator(scene);
        return scene;
      },
    });

    registry.updateScene(scene);

    registry.handlePointer(
      makePointerContext({ type: 'move', buttons: 0, fieldPoint: { x: 10, y: 10 } }),
    );
    expect((events.at(-1)?.data as any)?.kind).toBe('hover');

    registry.handlePointer(
      makePointerContext({ type: 'down', buttons: 1, fieldPoint: { x: 10, y: 10 } }),
    );
    registry.handlePointer(
      makePointerContext({ type: 'move', buttons: 1, fieldPoint: { x: 20, y: 25 } }),
    );

    expect((events.at(-1)?.data as any)?.kind).toBe('drag');
    expect(scene.scene.tokens[0]).toMatchObject({ x: 20, y: 25 });

    registry.handlePointer(
      makePointerContext({ type: 'up', buttons: 0, fieldPoint: { x: 20, y: 25 } }),
    );
    expect((events.at(-1)?.data as any)?.kind).toBe('release');
  });

  it('pen tool smooths points and appends drawings', () => {
    let scene = createSceneSnapshot({
      id: 'scene',
      field: { width: 80, height: 50 },
      leftTeam,
      rightTeam,
    });

    const events: DrawToolEvent[] = [];
    const registry = new DrawToolRegistry({
      onEvent: (event) => events.push(event),
      applySceneUpdate: (mutator) => {
        scene = mutator(scene);
        return scene;
      },
    });

    registry.updateScene(scene);
    registry.setActiveTool('pen');

    registry.handlePointer(
      makePointerContext({ type: 'down', fieldPoint: { x: 5, y: 5 }, buttons: 1 }),
    );
    registry.handlePointer(
      makePointerContext({ type: 'move', fieldPoint: { x: 7, y: 7 }, buttons: 1 }),
    );
    registry.handlePointer(
      makePointerContext({ type: 'up', fieldPoint: { x: 7, y: 7 }, buttons: 0 }),
    );

    const drawing = scene.scene.drawings[0];
    expect(drawing.kind).toBe('pen');
    if (drawing.kind === 'pen') {
      expect(drawing.points.length).toBeGreaterThanOrEqual(2);
    }
    expect((events.find((e) => (e.data as any)?.kind === 'pen-start')?.data as any)?.drawingId).toBeTruthy();
  });

  it('eraser removes drawings and emits events', () => {
    let scene = createSceneSnapshot({
      id: 'scene',
      field: { width: 80, height: 50 },
      leftTeam,
      rightTeam,
      drawings: [
        {
          id: 'pen-1',
          kind: 'pen',
          points: [
            { x: 0, y: 0 },
            { x: 5, y: 0 },
          ],
          stroke: '#fff',
          width: 2,
        },
      ],
    });

    const events: DrawToolEvent[] = [];
    const registry = new DrawToolRegistry({
      onEvent: (event) => events.push(event),
      applySceneUpdate: (mutator) => {
        scene = mutator(scene);
        return scene;
      },
    });

    registry.updateScene(scene);
    registry.setActiveTool('eraser');

    registry.handlePointer(
      makePointerContext({ type: 'down', fieldPoint: { x: 2.5, y: 0 }, buttons: 1 }),
    );

    expect(scene.scene.drawings).toHaveLength(0);
    expect(events.at(-1)?.data).toMatchObject({ kind: 'erase' });
  });
});
