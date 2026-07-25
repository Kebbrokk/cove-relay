// mapSurface.js
// Presentation-only renderer for a campaign map's visual layers: the image,
// the grid overlay, annotation shapes, text/measure labels, and tokens.
//
// It contains NO editing or interaction wiring and does not depend on the
// campaign editor's `this`. That's deliberate: the DM console (which layers
// drag/click/draw handlers on top of these pieces), the streaming pop-out,
// and future networked "seat" views all render maps from THIS one code path,
// so the picture a player sees can never quietly drift from the picture the
// DM is editing.
//
// Coordinates are the same PERCENT-of-image system (0-100) used everywhere
// else in the app, so every layer scales correctly at any window size or zoom
// with no per-view translation.
//
// Browser-safe: this file is part of the renderer import graph, so it must
// only import other browser-safe modules (no `node:` built-ins - see
// renderer-imports.test.js).

import { computeGridLines } from './grid.js';

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** Aspect ratio (height / width) used to keep grid squares square. */
export function imageAspectRatio(naturalWidth, naturalHeight) {
  if (!naturalWidth || !naturalHeight) return 1;
  return naturalHeight / naturalWidth;
}

// ---- DM / player visibility boundary -------------------------------------
// A "seat" view is any player-facing render (the streaming pop-out today,
// networked player windows later). When rendering FOR a seat, DM-only content
// is filtered out entirely so it never reaches the DOM a player could see.
// The DM's own editor renders with forPlayers:false and instead marks this
// content as hidden, so the DM always knows what will and won't be streamed.

export function isTokenHidden(token) {
  return !!token.hidden;
}

export function isAnnotationDmOnly(ann) {
  return !!ann.dmOnly;
}

export function visibleTokens(map, { forPlayers = false } = {}) {
  if (!forPlayers) return map.tokens;
  return map.tokens.filter((t) => !isTokenHidden(t));
}

export function visibleAnnotations(map, { forPlayers = false } = {}) {
  if (!forPlayers) return map.annotations;
  return map.annotations.filter((a) => !isAnnotationDmOnly(a));
}

// ---- individual visual layers --------------------------------------------

export function buildGridSvg(map, aspectRatio) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'map-grid-layer');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.opacity = String(map.grid.opacity ?? 0.55);

  const { vertical, horizontal } = computeGridLines(map.grid.columns, aspectRatio);
  for (const x of vertical) {
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', x); line.setAttribute('y1', 0);
    line.setAttribute('x2', x); line.setAttribute('y2', 100);
    line.setAttribute('class', 'map-grid-line');
    svg.appendChild(line);
  }
  for (const y of horizontal) {
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', 0); line.setAttribute('y1', y);
    line.setAttribute('x2', 100); line.setAttribute('y2', y);
    line.setAttribute('class', 'map-grid-line');
    svg.appendChild(line);
  }
  return svg;
}

/**
 * Builds the SVG element for a single non-text annotation (line, freehand,
 * rectangle, ellipse, cone, triangle, measure). This is the geometry that's
 * genuinely worth sharing between the editor and every seat view - the exact
 * shape a cone or measured line resolves to must be identical in both.
 */
export function buildAnnotationShapeEl(ann) {
  const styleFilled = (el) => {
    el.setAttribute('fill', ann.color);
    el.setAttribute('fill-opacity', '0.25');
    el.setAttribute('stroke', ann.color);
    el.setAttribute('stroke-width', '0.5');
    el.setAttribute('vector-effect', 'non-scaling-stroke');
    return el;
  };
  const styleLine = (el) => {
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', ann.color);
    el.setAttribute('stroke-width', String(ann.strokeWidth ?? 0.5));
    el.setAttribute('vector-effect', 'non-scaling-stroke');
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('stroke-linejoin', 'round');
    return el;
  };

  if (ann.type === 'freehand') {
    const el = document.createElementNS(SVG_NS, 'polyline');
    el.setAttribute('points', ann.points.map((p) => `${p.x},${p.y}`).join(' '));
    return styleLine(el);
  }
  if (ann.type === 'line' || ann.type === 'measure') {
    const [p1, p2] = ann.points;
    const el = document.createElementNS(SVG_NS, 'line');
    el.setAttribute('x1', p1.x); el.setAttribute('y1', p1.y);
    el.setAttribute('x2', p2.x); el.setAttribute('y2', p2.y);
    return styleLine(el);
  }
  if (ann.type === 'rectangle') {
    const [p1, p2] = ann.points;
    const el = document.createElementNS(SVG_NS, 'rect');
    el.setAttribute('x', Math.min(p1.x, p2.x));
    el.setAttribute('y', Math.min(p1.y, p2.y));
    el.setAttribute('width', Math.abs(p2.x - p1.x));
    el.setAttribute('height', Math.abs(p2.y - p1.y));
    return styleFilled(el);
  }
  if (ann.type === 'ellipse') {
    const [p1, p2] = ann.points;
    const el = document.createElementNS(SVG_NS, 'ellipse');
    el.setAttribute('cx', (p1.x + p2.x) / 2);
    el.setAttribute('cy', (p1.y + p2.y) / 2);
    el.setAttribute('rx', Math.abs(p2.x - p1.x) / 2);
    el.setAttribute('ry', Math.abs(p2.y - p1.y) / 2);
    return styleFilled(el);
  }
  // cone and triangle are both pre-computed 3-point polygons
  const el = document.createElementNS(SVG_NS, 'polygon');
  el.setAttribute('points', ann.points.map((p) => `${p.x},${p.y}`).join(' '));
  return styleFilled(el);
}

/** The visual <div> for a text annotation, with no click/remove handlers. */
export function buildTextAnnotationVisual(ann) {
  const el = document.createElement('div');
  el.className = 'map-text-annotation';
  el.style.left = ann.points[0].x + '%';
  el.style.top = ann.points[0].y + '%';
  el.style.color = ann.color;
  el.textContent = ann.text;
  return el;
}

/** The floating "X ft" label for a measure annotation. */
export function buildMeasureLabel(ann) {
  const [p1, p2] = ann.points;
  const el = document.createElement('div');
  el.className = 'map-measure-label';
  el.style.left = ((p1.x + p2.x) / 2) + '%';
  el.style.top = ((p1.y + p2.y) / 2) + '%';
  el.textContent = ann.text;
  return el;
}

/**
 * The visual <div> for a token, with no drag/roll handlers. When the token is
 * DM-hidden and we're rendering the DM's own editor (hidden tokens are
 * filtered out before they ever reach a seat view), it carries a marker class
 * so the DM can see at a glance what won't be streamed.
 */
export function buildTokenVisual(token, { highlighted = false } = {}) {
  const el = document.createElement('div');
  el.className = 'map-token'
    + (highlighted ? ' map-token-highlighted' : '')
    + (isTokenHidden(token) ? ' map-token-hidden' : '');
  el.dataset.tokenId = token.id; // lets views target a specific token (e.g. a seat highlighting its own)
  el.style.left = token.x + '%';
  el.style.top = token.y + '%';
  el.style.background = token.color;
  el.title = isTokenHidden(token) ? `${token.name} (hidden from players)` : token.name;
  el.textContent = token.name.slice(0, 2).toUpperCase();

  if (token.hp != null || token.ac != null) {
    const hoverInfo = document.createElement('div');
    hoverInfo.className = 'map-token-hover-info';
    if (token.hp != null) {
      const hpChip = document.createElement('span');
      hpChip.className = 'map-token-hover-chip map-token-hover-hp';
      hpChip.textContent = `HP ${token.hp}${token.maxHp != null ? '/' + token.maxHp : ''}`;
      hoverInfo.appendChild(hpChip);
    }
    if (token.ac != null) {
      const acChip = document.createElement('span');
      acChip.className = 'map-token-hover-chip map-token-hover-ac';
      acChip.textContent = `AC ${token.ac}`;
      hoverInfo.appendChild(acChip);
    }
    el.appendChild(hoverInfo);
  }
  return el;
}

/**
 * Assembles a complete, read-only map surface (image + grid + annotations +
 * labels + tokens) into a `.map-zoom-content` element and returns it. Used by
 * seat views (the streaming pop-out, and networked player views later); the DM
 * editor builds the same layers itself so it can weave interaction handlers in
 * between them, but every individual layer above is shared with this path.
 *
 * options:
 *   - forPlayers   filter out DM-only tokens/annotations (default true)
 *   - aspectRatio  image height/width, for square grid cells (default 1)
 *   - highlightedTokenId  token to pulse (e.g. the active turn), or null
 */
export function renderMapSurface(map, { forPlayers = true, aspectRatio = 1, highlightedTokenId = null } = {}) {
  const zoomContent = document.createElement('div');
  zoomContent.className = 'map-zoom-content';

  if (!map.imageDataUrl) {
    const empty = document.createElement('div');
    empty.className = 'map-empty';
    empty.textContent = 'The DM has not loaded an image for this map yet.';
    zoomContent.appendChild(empty);
    return zoomContent;
  }

  const img = document.createElement('img');
  img.className = 'map-image';
  img.src = map.imageDataUrl;
  img.draggable = false;
  zoomContent.appendChild(img);

  if (map.grid.enabled) {
    zoomContent.appendChild(buildGridSvg(map, aspectRatio));
  }

  const anns = visibleAnnotations(map, { forPlayers });

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'map-annotations-layer');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  for (const ann of anns) {
    if (ann.type === 'text') continue; // rendered as HTML below so fonts aren't distorted by the non-square viewBox
    svg.appendChild(buildAnnotationShapeEl(ann));
  }
  zoomContent.appendChild(svg);

  for (const ann of anns) {
    if (ann.type === 'text') zoomContent.appendChild(buildTextAnnotationVisual(ann));
    else if (ann.type === 'measure') zoomContent.appendChild(buildMeasureLabel(ann));
  }

  for (const token of visibleTokens(map, { forPlayers })) {
    zoomContent.appendChild(buildTokenVisual(token, { highlighted: token.id === highlightedTokenId }));
  }

  return zoomContent;
}
