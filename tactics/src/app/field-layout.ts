import type { FieldLine } from '@juggertools/core-domain';

export interface FieldLayoutPoint {
  x: number;
  y: number;
}

interface BaseLayoutElement {
  id: string;
  label?: string;
  stroke?: string;
  strokeWidth?: number;
  dash?: number[];
  opacity?: number;
}

export interface FieldLayoutLineElement extends BaseLayoutElement {
  kind: 'line';
  points: FieldLayoutPoint[];
  closePath?: boolean;
}

export interface FieldLayoutCircleElement extends BaseLayoutElement {
  kind: 'circle';
  radius: number;
  center: FieldLayoutPoint;
}

export type FieldLayoutElement =
  | FieldLayoutLineElement
  | FieldLayoutCircleElement;

export interface FieldLayoutDefinition {
  dimensions: {
    width: number;
    height: number;
  };
  elements: FieldLayoutElement[];
}

// Field dimensions are expressed in the same coordinate space as drawings/tokens.
// Align these units with existing scene data to keep scaling consistent.
export const FIELD_UNIT_WIDTH = 1132;
export const FIELD_UNIT_HEIGHT = 566;

const LAYOUT_WIDTH = 100;
const LAYOUT_HEIGHT = 100;

export const JUGGER_FIELD_LAYOUT: FieldLayoutDefinition = {
  dimensions: {
    width: LAYOUT_WIDTH,
    height: LAYOUT_HEIGHT,
  },
  elements: [
    {
      id: 'boundary',
      kind: 'line',
      stroke: 'rgba(248, 250, 252, 0.45)',
      strokeWidth: 0.75,
      closePath: true,
      points: [
        { x: 10.6, y: 0.4 },
        { x: 89.25, y: 0.45 },
        { x: 99.85, y: 21.2 },
        { x: 99.8, y: 78.95 },
        { x: 89.5, y: 99.5 },
        { x: 11.2, y: 99.5 },
        { x: 0.2, y: 78 },
        { x: 0.2, y: 20.85 },
      ],
    },
    {
      id: 'crosshair-vertical',
      kind: 'line',
      stroke: 'rgba(248, 250, 252, 0.55)',
      strokeWidth: 0.5,
      points: [
        { x: 50, y: 44.5 },
        { x: 50, y: 55.5 },
      ],
    },
  ],
};

export const DEFAULT_FIELD_DIMENSIONS = {
  width: FIELD_UNIT_WIDTH,
  height: FIELD_UNIT_HEIGHT,
};

export function buildFieldLinesFromLayout(layout: FieldLayoutDefinition): FieldLine[] {
  const lines: FieldLine[] = [];

  const scaleX = FIELD_UNIT_WIDTH / layout.dimensions.width;
  const scaleY = FIELD_UNIT_HEIGHT / layout.dimensions.height;

  layout.elements.forEach((element) => {
    if (element.kind !== 'line' || element.points.length < 2) {
      return;
    }

    for (let index = 0; index < element.points.length - 1; index += 1) {
      const start = element.points[index];
      const end = element.points[index + 1];
      lines.push({
        kind: 'mark',
        x1: start.x * scaleX,
        y1: start.y * scaleY,
        x2: end.x * scaleX,
        y2: end.y * scaleY,
        label: element.label,
      });
    }
  });

  return lines;
}
