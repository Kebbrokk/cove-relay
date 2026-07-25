// grid.js
// Pure logic for the map grid overlay and distance measurement. Kept
// separate from the map UI so the math (square cells regardless of image
// aspect ratio, distance-to-feet conversion) is testable without a DOM.
//
// The grid is defined by a single `columns` count (how many squares wide
// the DM says the map is) plus the image's aspect ratio - rows are always
// DERIVED from those two, never stored, so cells stay genuinely square
// even though positions are tracked in PERCENT (0-100) coordinates, which
// on their own don't account for the image not being literally square.

/**
 * How many grid rows fit down the image, given `columns` squares fit
 * across it and cells must be square. aspectRatio = naturalHeight / naturalWidth.
 */
export function computeGridRows(columns, aspectRatio) {
  if (!columns || columns <= 0 || !aspectRatio || aspectRatio <= 0) return 0;
  return columns * aspectRatio;
}

/**
 * Returns the percent (0-100) positions of every vertical and horizontal
 * grid line for rendering, given `columns` and the image's aspect ratio.
 */
export function computeGridLines(columns, aspectRatio) {
  const rows = computeGridRows(columns, aspectRatio);
  const vertical = [];
  const horizontal = [];
  if (columns > 0) {
    for (let i = 1; i < columns; i++) vertical.push((i / columns) * 100);
  }
  if (rows > 0) {
    const rowCount = Math.round(rows);
    for (let i = 1; i < rowCount; i++) horizontal.push((i / rows) * 100);
  }
  return { vertical, horizontal };
}

/**
 * Converts the straight-line distance between two points (in PERCENT
 * coordinates) into feet, using the map's grid settings and the image's
 * aspect ratio to correctly account for non-square images. The result is
 * rounded to the nearest whole grid square (so it reads in clean 5-ft
 * steps for a standard grid, matching how most tables expect distance to
 * read: 0, 5, 10, 15...), not a raw fractional value.
 */
export function measureDistanceFeet(p1, p2, grid, aspectRatio) {
  const rows = computeGridRows(grid.columns, aspectRatio);
  if (!grid.columns || !rows) return 0;

  const dxSquares = ((p2.x - p1.x) / 100) * grid.columns;
  const dySquares = ((p2.y - p1.y) / 100) * rows;
  const distanceSquares = Math.sqrt(dxSquares * dxSquares + dySquares * dySquares);
  const roundedSquares = Math.round(distanceSquares);
  return roundedSquares * grid.feetPerSquare;
}
