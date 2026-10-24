// Küttekõvera ruutregressioon y = a + b·x + c·x².
// Küttekõver on tavaliselt peaaegu lineaarne; ruutliige võtab arvesse kõvera kumerust.
export function fitCurve(points) {
  const data = (points ?? []).filter(point => Number.isFinite(point.outdoor) && Number.isFinite(point.target));
  if (data.length < 3) return null;
  const n = data.length;
  let sx = 0, sx2 = 0, sx3 = 0, sx4 = 0, sy = 0, sxy = 0, sx2y = 0;
  for (const { outdoor: x, target: y } of data) {
    const x2 = x * x;
    sx += x; sx2 += x2; sx3 += x2 * x; sx4 += x2 * x2;
    sy += y; sxy += x * y; sx2y += x2 * y;
  }
  // 3×3 maatriks (Gaussi elimineerimine)
  const matrix = [[n, sx, sx2, sy], [sx, sx2, sx3, sxy], [sx2, sx3, sx4, sx2y]];
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    if (Math.abs(matrix[pivot][col]) < 1e-9) return null;
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    for (let row = 0; row < 3; row++) {
      if (row === col) continue;
      const factor = matrix[row][col] / matrix[col][col];
      for (let k = col; k < 4; k++) matrix[row][k] -= factor * matrix[col][k];
    }
  }
  const [a, b, c] = matrix.map((row, index) => row[3] / row[index]);
  return { a, b, c, predict: x => a + b * x + c * x * x };
}
