// Softball-tuned ball tracker + flight detector.
//
// Strategy: on a small downscaled copy of each frame we look for pixels that
// (a) MOVED since the previous frame and (b) look like a softball (optic-yellow,
// or a bright white ball). Those pixels are grouped into blobs; the most
// ball-like small blob is the ball. Feeding frames over time gives a position/
// time series, and the longest fast horizontal sweep across the frame is the
// pitch. Speed itself is computed from the flight time by the caller (physics
// lives in config.js) — this module only finds *when* the ball was released and
// caught.

const PROC_W = 208; // processing width in px; height derives from aspect ratio

function isSoftballColor(r, g, b) {
  // optic yellow-green: strong green, weak blue, green >= red-ish
  const yellowGreen = g > 120 && g - b > 40 && r - b > 15 && b < 175;
  // bright (near-white) ball as a fallback; only ever counts alongside motion
  const white = r > 205 && g > 205 && b > 195;
  return yellowGreen || white;
}

// score how "softball-like" a color is, for ranking competing blobs
function colorScore(r, g, b) {
  const yg = Math.max(0, (g - b) + (r - b) * 0.4);
  const bright = (r + g + b) / 3 > 210 ? 40 : 0;
  return yg + bright;
}

export class BallTracker {
  constructor(opts = {}) {
    this.motionThresh = opts.motionThresh ?? 26;
    this.procW = opts.procW ?? PROC_W;
    this.canvas = null;
    this.ctx = null;
    this.reset();
  }

  reset() {
    this.prevGray = null;
    this.history = []; // { t, x, y, area, color } | { t, x:null } for a miss
    this.lastDetection = null;
  }

  _ensureCanvas(srcW, srcH) {
    const aspect = srcH / srcW || 9 / 16;
    const w = this.procW;
    const h = Math.max(2, Math.round(w * aspect));
    if (this.canvas && this._w === w && this._h === h) return;
    this._w = w;
    this._h = h;
    if (typeof OffscreenCanvas !== 'undefined') {
      this.canvas = new OffscreenCanvas(w, h);
    } else {
      this.canvas = document.createElement('canvas');
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.prevGray = null;
  }

  // Ingest one frame. `source` is anything drawImage accepts (video/canvas).
  // Returns the current detection (normalized coords) or null.
  update(source, srcW, srcH, timeSec) {
    this._ensureCanvas(srcW, srcH);
    const w = this._w;
    const h = this._h;
    this.ctx.drawImage(source, 0, 0, w, h);
    const img = this.ctx.getImageData(0, 0, w, h);
    const px = img.data;
    const n = w * h;

    const gray = new Uint8Array(n);
    const candidate = new Uint8Array(n);
    const prev = this.prevGray;

    if (prev) {
      for (let i = 0; i < n; i++) {
        const j = i * 4;
        const r = px[j], g = px[j + 1], b = px[j + 2];
        const y = (r * 77 + g * 150 + b * 29) >> 8;
        gray[i] = y;
        if (Math.abs(y - prev[i]) > this.motionThresh && isSoftballColor(r, g, b)) {
          candidate[i] = 1;
        }
      }
    } else {
      for (let i = 0; i < n; i++) {
        const j = i * 4;
        gray[i] = (px[j] * 77 + px[j + 1] * 150 + px[j + 2] * 29) >> 8;
      }
    }
    this.prevGray = gray;

    const detection = prev ? this._pickBall(candidate, px, w, h) : null;
    this.lastDetection = detection;
    if (detection) {
      this.history.push({ t: timeSec, x: detection.x, y: detection.y, area: detection.area, color: detection.color });
    } else {
      this.history.push({ t: timeSec, x: null });
    }
    return detection;
  }

  // Flood-fill blobs over the candidate mask and pick the most ball-like one.
  _pickBall(mask, px, w, h) {
    const n = w * h;
    const seen = new Uint8Array(n);
    const stack = new Int32Array(n);
    const totalPx = n;
    const minArea = 2;
    const maxArea = Math.max(8, Math.round(totalPx * 0.06)); // reject body-sized motion
    let best = null;

    for (let start = 0; start < n; start++) {
      if (!mask[start] || seen[start]) continue;
      let sp = 0;
      stack[sp++] = start;
      seen[start] = 1;
      let area = 0, sx = 0, sy = 0, minX = w, maxX = 0, minY = h, maxY = 0;
      let cSum = 0;
      while (sp > 0) {
        const p = stack[--sp];
        const y = (p / w) | 0;
        const x = p - y * w;
        area++;
        sx += x; sy += y;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        const j = p * 4;
        cSum += colorScore(px[j], px[j + 1], px[j + 2]);
        // 4-neighbours
        if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
        if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w; }
        if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w; }
      }
      if (area < minArea || area > maxArea) continue;
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      const fill = area / (bw * bh);
      if (fill < 0.12) continue; // sparse => not a compact ball/streak
      if (bw > w * 0.6 || bh > h * 0.6) continue; // too big to be a ball
      const avgColor = cSum / area;
      // prefer strong softball colour and compactness; motion blur makes the
      // ball a small streak, so a mild elongation is fine.
      const score = avgColor + fill * 30 - area * 0.05;
      if (!best || score > best.score) {
        best = {
          score,
          x: (sx / area) / w,
          y: (sy / area) / h,
          area,
          color: avgColor,
        };
      }
    }
    return best;
  }

  // Analyse everything ingested so far and return the best pitch window.
  // Returns { tRelease, tCatch, flightSeconds, points, spanFrac, direction } | null
  findBestFlight() {
    return BallTracker.analyzeHistory(this.history);
  }

  static analyzeHistory(history) {
    // split into contiguous runs of detections, tolerating short gaps
    const runs = [];
    let cur = [];
    let gap = 0;
    for (const h of history) {
      if (h.x == null) {
        gap++;
        if (gap > 2) { if (cur.length) runs.push(cur); cur = []; }
        continue;
      }
      gap = 0;
      if (cur.length) {
        const prev = cur[cur.length - 1];
        // reject teleports: a real ball moves smoothly frame to frame
        const jump = Math.hypot(h.x - prev.x, h.y - prev.y);
        if (jump > 0.5) { runs.push(cur); cur = []; }
      }
      cur.push(h);
    }
    if (cur.length) runs.push(cur);

    let best = null;
    for (const run of runs) {
      if (run.length < 3) continue;
      const xs = run.map((p) => p.x);
      const first = run[0];
      const last = run[run.length - 1];
      const net = last.x - first.x;
      const spanFrac = Math.abs(net);
      if (spanFrac < 0.28) continue; // must sweep a good part of the frame
      const dt = last.t - first.t;
      if (dt <= 0) continue;
      // monotonic consistency: fraction of steps moving in the net direction
      let consistent = 0;
      for (let i = 1; i < xs.length; i++) {
        if (Math.sign(xs[i] - xs[i - 1]) === Math.sign(net)) consistent++;
      }
      const monotonicity = consistent / (xs.length - 1);
      if (monotonicity < 0.6) continue;
      const score = spanFrac * monotonicity * Math.min(run.length, 30);
      if (!best || score > best.score) {
        best = {
          score,
          tRelease: first.t,
          tCatch: last.t,
          flightSeconds: dt,
          spanFrac,
          monotonicity,
          direction: net >= 0 ? 'L2R' : 'R2L',
          points: run,
        };
      }
    }
    return best;
  }
}

// Lightweight live state machine wrapping BallTracker, used by the camera view
// to fire a callback the instant a pitch completes.
export class LivePitchDetector {
  constructor(onPitch, opts = {}) {
    this.tracker = new BallTracker(opts);
    this.onPitch = onPitch;
    this.window = []; // rolling recent detections
    this.windowSec = opts.windowSec ?? 1.4;
    this.cooldownUntil = 0;
  }

  reset() {
    this.tracker.reset();
    this.window = [];
    this.cooldownUntil = 0;
  }

  update(source, srcW, srcH, timeSec) {
    const det = this.tracker.update(source, srcW, srcH, timeSec);
    this.window.push(det ? { t: timeSec, x: det.x, y: det.y } : { t: timeSec, x: null });
    // drop stale samples
    while (this.window.length && timeSec - this.window[0].t > this.windowSec) {
      this.window.shift();
    }
    if (timeSec < this.cooldownUntil) return det;

    // a pitch is "done" when we currently see nothing but the recent window
    // holds a completed fast sweep
    const recentMiss = !det;
    if (recentMiss) {
      const flight = BallTracker.analyzeHistory(this.window);
      if (flight && flight.spanFrac > 0.45 && flight.flightSeconds > 0.12 && flight.flightSeconds < 1.1) {
        this.cooldownUntil = timeSec + 0.8; // debounce so one pitch fires once
        this.window = [];
        this.onPitch(flight);
      }
    }
    return det;
  }
}
