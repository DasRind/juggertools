// Lightweight 2D affine matrix helpers used across Jugger tools.

export interface Matrix2D {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export interface PointLike {
  x: number;
  y: number;
}

export type RotationDirection = 'cw' | 'ccw';

export const IDENTITY_MATRIX: Matrix2D = Object.freeze({
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: 0,
  ty: 0,
});

export function createMatrix(params?: Partial<Matrix2D>): Matrix2D {
  return {
    ...IDENTITY_MATRIX,
    ...params,
  };
}

export function matrixMultiply(m1: Matrix2D, m2: Matrix2D): Matrix2D {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    tx: m1.a * m2.tx + m1.c * m2.ty + m1.tx,
    ty: m1.b * m2.tx + m1.d * m2.ty + m1.ty,
  };
}

export function matrixDeterminant({ a, b, c, d }: Matrix2D): number {
  return a * d - b * c;
}

export function matrixInvert(m: Matrix2D): Matrix2D {
  const det = matrixDeterminant(m);
  if (Math.abs(det) < Number.EPSILON) {
    throw new Error('Matrix is not invertible.');
  }

  const invDet = 1 / det;
  return {
    a: m.d * invDet,
    b: -m.b * invDet,
    c: -m.c * invDet,
    d: m.a * invDet,
    tx: (m.c * m.ty - m.d * m.tx) * invDet,
    ty: (m.b * m.tx - m.a * m.ty) * invDet,
  };
}

export function matrixApplyToPoint(m: Matrix2D, point: PointLike): PointLike {
  return {
    x: m.a * point.x + m.c * point.y + m.tx,
    y: m.b * point.x + m.d * point.y + m.ty,
  };
}

export function matrixRotate90(m: Matrix2D, direction: RotationDirection = 'cw'): Matrix2D {
  const rotation: Matrix2D =
    direction === 'cw'
      ? { a: 0, b: 1, c: -1, d: 0, tx: 0, ty: 0 }
      : { a: 0, b: -1, c: 1, d: 0, tx: 0, ty: 0 };
  return matrixMultiply(m, rotation);
}

export function matrixTranslate(tx: number, ty: number): Matrix2D {
  return { a: 1, b: 0, c: 0, d: 1, tx, ty };
}

export function matrixScale(sx: number, sy: number = sx): Matrix2D {
  return { a: sx, b: 0, c: 0, d: sy, tx: 0, ty: 0 };
}

export function matrixEquals(m1: Matrix2D, m2: Matrix2D, epsilon = 1e-6): boolean {
  return (
    Math.abs(m1.a - m2.a) < epsilon &&
    Math.abs(m1.b - m2.b) < epsilon &&
    Math.abs(m1.c - m2.c) < epsilon &&
    Math.abs(m1.d - m2.d) < epsilon &&
    Math.abs(m1.tx - m2.tx) < epsilon &&
    Math.abs(m1.ty - m2.ty) < epsilon
  );
}

export function isIdentityMatrix(m: Matrix2D, epsilon = 1e-6): boolean {
  return matrixEquals(m, IDENTITY_MATRIX, epsilon);
}

export function composeTransforms(transforms: Matrix2D[]): Matrix2D {
  return transforms.reduce(matrixMultiply, IDENTITY_MATRIX);
}
