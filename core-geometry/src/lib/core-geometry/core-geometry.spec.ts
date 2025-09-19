import {
  composeTransforms,
  IDENTITY_MATRIX,
  isIdentityMatrix,
  matrixApplyToPoint,
  matrixEquals,
  matrixInvert,
  matrixMultiply,
  matrixRotate90,
  matrixScale,
  matrixTranslate,
} from './core-geometry';

describe('core-geometry matrix helpers', () => {
  it('multiplies matrices correctly', () => {
    const result = matrixMultiply(matrixScale(2), matrixTranslate(10, -5));
    expect(result.a).toBe(2);
    expect(result.tx).toBe(20);
    expect(result.ty).toBe(-10);
  });

  it('inverts an affine transform', () => {
    const transform = composeTransforms([
      matrixScale(2, 3),
      matrixTranslate(5, -7),
    ]);
    const inverted = matrixInvert(transform);
    expect(isIdentityMatrix(matrixMultiply(transform, inverted))).toBe(true);
  });

  it('applies a transform to a point', () => {
    const transform = composeTransforms([
      matrixTranslate(10, 5),
      matrixScale(2),
    ]);
    const point = matrixApplyToPoint(transform, { x: 3, y: 4 });
    expect(point).toEqual({ x: 16, y: 13 });
  });

  it('rotates 90 degrees clockwise', () => {
    const rotated = matrixRotate90(IDENTITY_MATRIX, 'cw');
    const point = matrixApplyToPoint(rotated, { x: 1, y: 0 });
    expect(matrixEquals(rotated, { a: 0, b: 1, c: -1, d: 0, tx: 0, ty: 0 })).toBe(true);
    expect(point).toEqual({ x: 0, y: 1 });
  });

  it('rotates 90 degrees counter-clockwise', () => {
    const rotated = matrixRotate90(IDENTITY_MATRIX, 'ccw');
    const point = matrixApplyToPoint(rotated, { x: 1, y: 0 });
    expect(point).toEqual({ x: 0, y: -1 });
  });

  it('reports identity matrices', () => {
    expect(isIdentityMatrix(IDENTITY_MATRIX)).toBe(true);
    const translated = matrixTranslate(1, 1);
    expect(isIdentityMatrix(translated)).toBe(false);
  });
});
