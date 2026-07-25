// mapCamera.js
// A small, framework-free pan/zoom/fit controller shared by every player-facing
// map view: the streaming pop-out (Electron) and the LAN seat page (browser).
// Both need an INDEPENDENT camera over a read-only map surface - the same
// behavior - so it lives here once instead of being copied into each.
//
// It transforms a `content` element inside a clipping `stage` element with a
// CSS `translate()+scale()`. Because the map surface uses percent-based
// coordinates internally (see mapSurface.js), scaling the whole content with a
// transform keeps tokens, grid, and annotations perfectly aligned - and since
// these views are view-only, the coordinate-accuracy concerns that rule out a
// CSS transform in the editor don't apply here.
//
// Browser-safe: no imports, no Node built-ins, no app globals.

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;

export class MapCamera {
  /**
   * @param stage    the clipping viewport element (overflow: hidden)
   * @param content  the element that gets transformed (holds the map surface)
   * @param options.onZoomChange  called with the scale (0-1..) whenever it changes
   * @param options.refitOnResize when true, re-fit whenever the stage resizes
   */
  constructor(stage, content, { onZoomChange = () => {}, refitOnResize = true } = {}) {
    this.stage = stage;
    this.content = content;
    this.onZoomChange = onZoomChange;
    this._size = null;            // { width, height } of the content's natural pixel box
    this._scale = 1;
    this._offset = { x: 0, y: 0 };
    this._wire(refitOnResize);
  }

  /** Sets the content's natural pixel size (e.g. the map image's dimensions). */
  setContentSize(width, height) {
    this._size = { width, height };
  }

  hasContent() {
    return !!this._size;
  }

  get scale() {
    return this._scale;
  }

  /** Scales and centers the content so it's fully visible (letterboxed). */
  fit() {
    if (!this._size) return;
    const rect = this.stage.getBoundingClientRect();
    const scale = Math.min(rect.width / this._size.width, rect.height / this._size.height);
    this._scale = clamp(scale, MIN_SCALE, MAX_SCALE);
    this._offset = {
      x: (rect.width - this._size.width * this._scale) / 2,
      y: (rect.height - this._size.height * this._scale) / 2,
    };
    this.apply();
  }

  /** Zooms toward a stage-relative point (defaults to the stage center). */
  zoomAt(factor, stageX, stageY) {
    if (!this._size) return;
    const rect = this.stage.getBoundingClientRect();
    const px = stageX ?? rect.width / 2;
    const py = stageY ?? rect.height / 2;
    const newScale = clamp(this._scale * factor, MIN_SCALE, MAX_SCALE);
    // Keep the content point under the cursor fixed while scaling.
    const cx = (px - this._offset.x) / this._scale;
    const cy = (py - this._offset.y) / this._scale;
    this._offset = { x: px - cx * newScale, y: py - cy * newScale };
    this._scale = newScale;
    this.apply();
  }

  apply() {
    this.content.style.transform = `translate(${this._offset.x}px, ${this._offset.y}px) scale(${this._scale})`;
    this.onZoomChange(this._scale);
  }

  _wire(refitOnResize) {
    this.stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.stage.getBoundingClientRect();
      this.zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });

    // Any-button drag pans - there's nothing to click on a view-only surface.
    let panning = false;
    let startX = 0;
    let startY = 0;
    let startOffset = null;
    this.stage.addEventListener('mousedown', (e) => {
      panning = true;
      startX = e.clientX;
      startY = e.clientY;
      startOffset = { ...this._offset };
      this.stage.classList.add('is-panning');
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!panning) return;
      this._offset = { x: startOffset.x + (e.clientX - startX), y: startOffset.y + (e.clientY - startY) };
      this.apply();
    });
    const stop = () => { panning = false; this.stage.classList.remove('is-panning'); };
    window.addEventListener('mouseup', stop);
    this.stage.addEventListener('mouseleave', stop);

    if (refitOnResize) window.addEventListener('resize', () => this.fit());
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
