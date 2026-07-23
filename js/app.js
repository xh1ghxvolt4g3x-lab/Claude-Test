import { AGE_GROUPS, DEFAULT_AGE, CAMERA_CONSTRAINTS, distanceForAge, speedFromFlight } from './config.js';
import { BallTracker, LivePitchDetector } from './tracker.js';

const $ = (id) => document.getElementById(id);
const PREFS = 'pitchgun.prefs';
// Bump on each release so users can confirm (Settings) they're on the latest.
const APP_VERSION = '2.3 — Lighting meter (2026-07-23)';

const state = {
  mode: 'record',
  ageId: DEFAULT_AGE,
  radarStyle: false,
  sensitivity: 26,
  showGuide: true,
  stream: null,
  trackW: 1280,
  trackH: 720,
  fps: 30,
  frameDur: 1 / 30,
  liveRunning: false,
  live: null,          // LivePitchDetector
  lastSpeed: null,     // last computed speed object
  recorder: null,
  recChunks: [],
  // analyzer
  clipFrameDur: 1 / 30,
  release: null,
  catch: null,
  analyzerSpeed: null,
};

// ---------- prefs ----------
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS) || '{}');
    Object.assign(state, {
      ageId: p.ageId ?? DEFAULT_AGE,
      radarStyle: !!p.radarStyle,
      sensitivity: p.sensitivity ?? 26,
      showGuide: p.showGuide ?? true,
    });
  } catch { /* ignore */ }
}
function savePrefs() {
  localStorage.setItem(PREFS, JSON.stringify({
    ageId: state.ageId, radarStyle: state.radarStyle,
    sensitivity: state.sensitivity, showGuide: state.showGuide,
  }));
}

// ---------- toast ----------
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}

// ---------- camera ----------
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS);
    state.stream = stream;
    const cam = $('camera');
    cam.srcObject = stream;
    await cam.play().catch(() => {});
    const track = stream.getVideoTracks()[0];
    const s = track.getSettings();
    state.trackW = s.width || cam.videoWidth || 1280;
    state.trackH = s.height || cam.videoHeight || 720;
    state.fps = Math.round(s.frameRate || 30);
    state.frameDur = 1 / (state.fps || 30);
    $('capBadge').textContent = `${state.trackH || '?'}p · ${state.fps}fps`;
    renderCamDetail(s);
    // apply continuous focus/exposure if available
    try {
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      const adv = [];
      if (caps.focusMode && caps.focusMode.includes('continuous')) adv.push({ focusMode: 'continuous' });
      if (caps.exposureMode && caps.exposureMode.includes('continuous')) adv.push({ exposureMode: 'continuous' });
      if (adv.length) await track.applyConstraints({ advanced: adv });
    } catch { /* not supported */ }
    startLiveLoop();
  } catch (err) {
    toast('Camera access needed. Allow the camera in Settings ▸ Safari, then reload.', 6000);
    $('statusLine').textContent = 'Camera unavailable — you can still Import a clip.';
    $('capBadge').textContent = 'no camera';
    console.error(err);
  }
}

function renderCamDetail(s) {
  const lines = [
    `Resolution: ${s.width}×${s.height}`,
    `Frame rate: ${Math.round(s.frameRate || 0)} fps`,
    `Facing: ${s.facingMode || 'environment'}`,
  ];
  $('camDetail').textContent =
    lines.join('\n') +
    '\n\nWeb browsers can’t access the iPhone’s 240fps slow-mo. For the finest timing, record a slow-mo clip in the Camera app and use Import.';
}

// ---------- live detection loop ----------
function makeLive() {
  return new LivePitchDetector((flight) => onLivePitch(flight), {
    motionThresh: state.sensitivity,
  });
}

function startLiveLoop() {
  if (state.liveRunning) return;
  state.liveRunning = true;
  state.live = makeLive();
  const cam = $('camera');
  const useRVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;

  const frame = (now) => {
    if (!state.liveRunning) return;
    const ts = (typeof now === 'number' ? now : performance.now());
    if (state.mode === 'live' && cam.readyState >= 2) {
      const det = state.live.update(cam, state.trackW, state.trackH, ts / 1000);
      if (det) $('statusLine').textContent = 'Tracking ball…';
    }
    sampleLighting(cam, ts); // runs in every mode, throttled internally
    if (useRVFC) cam.requestVideoFrameCallback(frame);
  };
  if (useRVFC) cam.requestVideoFrameCallback(frame);
  else {
    const loop = () => { if (!state.liveRunning) return; frame(performance.now()); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
}
function stopLiveLoop() { state.liveRunning = false; }

// ---------- lighting quality meter ----------
// The camera auto-exposes, but we can't force a fast shutter from the web, so in
// dim light the ball motion-blurs. This samples average scene brightness and
// warns the user when conditions will hurt detection. Purely advisory.
let _lightCanvas, _lightCtx, _lightNextAt = 0;
function sampleLighting(cam, ts) {
  if (ts < _lightNextAt || cam.readyState < 2) return;
  _lightNextAt = ts + 700; // ~1.4x per second is plenty
  if (!_lightCanvas) {
    _lightCanvas = document.createElement('canvas');
    _lightCanvas.width = 32; _lightCanvas.height = 18;
    _lightCtx = _lightCanvas.getContext('2d', { willReadFrequently: true });
  }
  let avg;
  try {
    _lightCtx.drawImage(cam, 0, 0, 32, 18);
    const d = _lightCtx.getImageData(0, 0, 32, 18).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    avg = sum / (d.length / 4);
  } catch { return; }

  const badge = $('lightBadge');
  badge.classList.remove('low', 'warn');
  if (avg >= 105) {
    badge.textContent = '☀︎ Good light';
  } else if (avg >= 65) {
    badge.textContent = '◐ OK light';
    badge.classList.add('warn');
  } else {
    badge.textContent = '☾ Low light';
    badge.classList.add('low');
  }
  badge.hidden = false;
}

function onLivePitch(flight) {
  const dist = distanceForAge(state.ageId);
  const speed = speedFromFlight(dist, flight.flightSeconds, state.radarStyle);
  if (!speed || speed.mph < 12 || speed.mph > 110) return; // reject implausible
  state.lastSpeed = speed;
  showLiveNumber(speed);
  freezeLiveSnapshot(speed);
  $('lastBtn').disabled = false;
}

function showLiveNumber(speed) {
  const lr = $('liveReadout');
  $('lrValue').textContent = speed.mph.toFixed(1);
  $('lrSub').textContent = `${state.ageId} · ${speed.distanceFt} ft · flight ${(speed.flightSeconds * 1000).toFixed(0)} ms`;
  lr.classList.remove('hidden');
  lr.classList.remove('flash'); void lr.offsetWidth; lr.classList.add('flash');
  $('statusLine').textContent = state.radarStyle ? 'Radar-style (release) estimate' : 'Average flight speed';
  clearTimeout(showLiveNumber._t);
  showLiveNumber._t = setTimeout(() => lr.classList.add('hidden'), 4000);
}

// snapshot current camera frame + speed tag into the live card canvas
function freezeLiveSnapshot(speed) {
  const cam = $('camera');
  const cv = $('liveSnap');
  const w = state.trackW, h = state.trackH;
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  try { ctx.drawImage(cam, 0, 0, w, h); } catch { /* frame not ready */ }
  drawSpeedTag(ctx, w, h, speed);
  $('liveCard').dataset.name = speedFilename(speed);
  $('liveCard').classList.remove('hidden');
}

// ---------- speed overlay drawing ----------
function drawSpeedTag(ctx, w, h, speed) {
  const pad = Math.round(w * 0.03);
  const fs = Math.round(w * 0.075);       // big number size
  const sub = Math.round(w * 0.03);
  const boxW = Math.round(w * 0.42);
  const boxH = Math.round(fs * 1.9);
  const x = pad, y = h - boxH - pad;

  ctx.save();
  roundRect(ctx, x, y, boxW, boxH, Math.round(boxH * 0.18));
  ctx.fillStyle = 'rgba(6,12,24,0.72)';
  ctx.fill();

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#dff046';
  ctx.font = `800 ${fs}px -apple-system, "SF Pro Text", Roboto, sans-serif`;
  const numTxt = speed.mph.toFixed(1);
  ctx.fillText(numTxt, x + pad * 0.7, y + boxH * 0.62);
  const numW = ctx.measureText(numTxt).width;
  ctx.fillStyle = '#f4f7fb';
  ctx.font = `700 ${Math.round(fs * 0.42)}px -apple-system, Roboto, sans-serif`;
  ctx.fillText('mph', x + pad * 0.7 + numW + 8, y + boxH * 0.62);

  ctx.fillStyle = '#9fb0c4';
  ctx.font = `600 ${sub}px -apple-system, Roboto, sans-serif`;
  const tag = `${state.ageId} · ${speed.distanceFt} ft${speed.radarStyle ? ' · radar-est' : ''}`;
  ctx.fillText(tag, x + pad * 0.7, y + boxH - pad * 0.5);
  // app mark, bottom-right of frame
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = `600 ${sub}px -apple-system, Roboto, sans-serif`;
  ctx.fillText('PitchGun', w - pad, h - pad);
  ctx.restore();
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------- save / share ----------
function speedFilename(speed, ext = 'jpg') {
  return `pitch-${speed.mph.toFixed(1)}mph-${state.ageId}.${ext}`;
}
async function saveOrShare(blob, filename, kind) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast(`${kind} saved to Downloads. Tap to open, then Share ▸ Save to Photos.`, 4200);
}
function canvasToBlob(cv, type = 'image/jpeg', q = 0.92) {
  return new Promise((res) => cv.toBlob((b) => res(b), type, q));
}

// ---------- recording ----------
function pickMime() {
  const c = ['video/mp4;codecs=h264', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const m of c) if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  return '';
}
function startRecording() {
  if (!state.stream) { toast('No camera to record.'); return; }
  const mime = pickMime();
  try {
    state.recorder = new MediaRecorder(state.stream, mime ? { mimeType: mime } : undefined);
  } catch (e) { toast('Recording not supported on this browser.'); return; }
  state.recChunks = [];
  state.recorder.ondataavailable = (e) => { if (e.data && e.data.size) state.recChunks.push(e.data); };
  state.recorder.onstop = () => {
    const blob = new Blob(state.recChunks, { type: state.recorder.mimeType || 'video/mp4' });
    openAnalyzer(URL.createObjectURL(blob), blob);
  };
  state.recorder.start();
  $('shutter').classList.add('recording');
  $('statusLine').textContent = 'Recording… tap to stop';
}
function stopRecording() {
  if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop();
  $('shutter').classList.remove('recording');
}

// ---------- analyzer ----------
let analyzerBlob = null;
function openAnalyzer(src, blob) {
  analyzerBlob = blob || null;
  stopLiveLoop();
  const clip = $('clip');
  clip.src = src;
  state.release = null; state.catch = null; state.analyzerSpeed = null;
  $('analyzeSpeed').classList.add('hidden');
  $('analyzer').classList.remove('hidden');
  $('analyzerNote').textContent = 'Loading clip…';
  clip.load();
  clip.onloadeddata = async () => {
    sizeOverlay();
    $('analyzerNote').textContent = 'Analyzing… detecting the ball';
    await autoDetect();
  };
}
function closeAnalyzer() {
  const clip = $('clip');
  clip.pause();
  if (clip.src && clip.src.startsWith('blob:')) URL.revokeObjectURL(clip.src);
  clip.removeAttribute('src'); clip.load();
  $('analyzer').classList.add('hidden');
  startLiveLoop();
}

function sizeOverlay() {
  const clip = $('clip');
  const cv = $('overlayCanvas');
  cv.width = clip.videoWidth || 1280;
  cv.height = clip.videoHeight || 720;
}

// play the clip once, sampling frames, to build a track + measure frame rate
function analyzeClip() {
  return new Promise((resolve) => {
    const clip = $('clip');
    const tracker = new BallTracker({ motionThresh: state.sensitivity });
    const times = [];
    const useRVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      // frame duration = median positive delta
      const diffs = [];
      for (let i = 1; i < times.length; i++) { const d = times[i] - times[i - 1]; if (d > 0) diffs.push(d); }
      diffs.sort((a, b) => a - b);
      state.clipFrameDur = diffs.length ? diffs[Math.floor(diffs.length / 2)] : 1 / 30;
      clip.pause();
      resolve(tracker.findBestFlight());
    };
    const onFrame = (now, meta) => {
      const t = meta ? meta.mediaTime : clip.currentTime;
      times.push(t);
      tracker.update(clip, clip.videoWidth, clip.videoHeight, t);
      if (clip.ended || clip.currentTime >= clip.duration - 0.001) return finish();
      if (useRVFC) clip.requestVideoFrameCallback(onFrame);
    };
    clip.onended = finish;
    clip.muted = true; clip.currentTime = 0;
    clip.play().then(() => {
      if (useRVFC) clip.requestVideoFrameCallback(onFrame);
      else {
        const loop = () => { if (done) return; onFrame(); if (!clip.ended) requestAnimationFrame(loop); else finish(); };
        requestAnimationFrame(loop);
      }
    }).catch(() => finish());
    // safety timeout
    setTimeout(finish, 15000);
  });
}

async function autoDetect() {
  const flight = await analyzeClip();
  if (flight) {
    state.release = flight.tRelease;
    state.catch = flight.tCatch;
    recomputeAnalyzer();
    $('analyzerNote').textContent = 'Auto-detected. Scrub and nudge Release/Catch to fine-tune.';
    await seekTo(state.release);
  } else {
    $('analyzerNote').textContent = 'Couldn’t auto-detect a pitch. Scrub to the release frame, tap “Set Release”, then the catch frame, tap “Set Catch”.';
    await seekTo(0);
  }
}

function recomputeAnalyzer() {
  const clip = $('clip');
  const dur = clip.duration || 1;
  // position marks
  if (state.release != null) placeMark('markRelease', state.release / dur);
  if (state.catch != null) placeMark('markCatch', state.catch / dur);
  if (state.release != null && state.catch != null && state.catch > state.release) {
    const dist = distanceForAge(state.ageId);
    const speed = speedFromFlight(dist, state.catch - state.release, state.radarStyle);
    state.analyzerSpeed = speed;
    $('asValue').textContent = speed.mph.toFixed(1);
    $('analyzeSpeed').classList.remove('hidden');
  } else {
    state.analyzerSpeed = null;
    $('analyzeSpeed').classList.add('hidden');
  }
}
function placeMark(id, frac) {
  frac = Math.max(0, Math.min(1, frac));
  $(id).style.left = (frac * 100) + '%';
}

function seekTo(t) {
  return new Promise((resolve) => {
    const clip = $('clip');
    const dur = clip.duration || 1;
    t = Math.max(0, Math.min(dur - 1e-3, t));
    const done = () => { clip.removeEventListener('seeked', done); drawAnalyzerOverlay(); resolve(); };
    clip.addEventListener('seeked', done);
    clip.currentTime = t;
    $('scrub').value = String(Math.round((t / dur) * 1000));
  });
}

function drawAnalyzerOverlay() {
  const clip = $('clip');
  const cv = $('overlayCanvas');
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  // mark whether current frame is release/catch
  const near = (a, b) => a != null && Math.abs(clip.currentTime - a) < state.clipFrameDur * 0.75;
  if (near(state.release)) tagCorner(ctx, cv, 'RELEASE', '#128f80', 'tl');
  if (near(state.catch)) tagCorner(ctx, cv, 'CATCH', '#e0503a', 'tr');
}
function tagCorner(ctx, cv, text, color, pos) {
  const fs = Math.round(cv.width * 0.035);
  ctx.font = `700 ${fs}px -apple-system, Roboto, sans-serif`;
  const w = ctx.measureText(text).width + fs;
  const x = pos === 'tl' ? 10 : cv.width - w - 10;
  ctx.fillStyle = color; roundRect(ctx, x, 10, w, fs * 1.6, 8); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + fs / 2, 10 + fs * 0.85);
}

// render a full-res tagged still of the current analyzer frame
async function saveAnalyzerPhoto() {
  if (!state.analyzerSpeed) { toast('Set Release and Catch first.'); return; }
  const clip = $('clip');
  const w = clip.videoWidth, h = clip.videoHeight;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.drawImage(clip, 0, 0, w, h);
  drawSpeedTag(ctx, w, h, state.analyzerSpeed);
  const blob = await canvasToBlob(cv, 'image/jpeg', 0.92);
  await saveOrShare(blob, speedFilename(state.analyzerSpeed, 'jpg'), 'Photo');
}

// re-encode the clip with the speed burned in, from release to a bit past catch
async function saveAnalyzerClip() {
  if (!state.analyzerSpeed) { toast('Set Release and Catch first.'); return; }
  if (!window.MediaRecorder) { toast('Clip export not supported here — use Save Photo.'); return; }
  const clip = $('clip');
  const w = clip.videoWidth, h = clip.videoHeight;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const mime = pickMime();
  const stream = cv.captureStream(30);
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const from = Math.max(0, state.release - 0.15);
  const to = Math.min(clip.duration, state.catch + 0.35);

  $('analyzerNote').textContent = 'Rendering tagged clip…';
  await seekTo(from);
  await new Promise((resolve) => {
    rec.onstop = resolve;
    rec.start();
    clip.muted = true; clip.play();
    const pump = () => {
      ctx.drawImage(clip, 0, 0, w, h);
      drawSpeedTag(ctx, w, h, state.analyzerSpeed);
      if (clip.currentTime >= to || clip.ended) { clip.pause(); rec.stop(); return; }
      if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) clip.requestVideoFrameCallback(pump);
      else requestAnimationFrame(pump);
    };
    if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) clip.requestVideoFrameCallback(pump);
    else requestAnimationFrame(pump);
  });
  const ext = (rec.mimeType || '').includes('mp4') ? 'mp4' : 'webm';
  const blob = new Blob(chunks, { type: rec.mimeType || 'video/mp4' });
  $('analyzerNote').textContent = 'Saved.';
  await saveOrShare(blob, speedFilename(state.analyzerSpeed, ext), 'Clip');
}

// ---------- UI wiring ----------
function populateAges() {
  const sel = $('ageSelect');
  sel.innerHTML = '';
  for (const g of AGE_GROUPS) {
    const o = document.createElement('option');
    o.value = g.id; o.textContent = `${g.label} · ${g.note}`;
    if (g.id === state.ageId) o.selected = true;
    sel.appendChild(o);
  }
}
function setMode(mode) {
  state.mode = mode;
  $('modeLive').classList.toggle('active', mode === 'live');
  $('modeRecord').classList.toggle('active', mode === 'record');
  $('framingGuide').classList.toggle('hidden', !state.showGuide);
  if (mode === 'live') {
    // Auto (live detection) is opt-in. Clear any stale motion history so the
    // act of switching / moving the phone doesn't fire a false reading.
    if (state.live) state.live.reset();
    state.lastSpeed = null;
    $('statusLine').textContent = 'Auto ⚡ ON — hold the phone steady; speeds read automatically';
    $('shutter').setAttribute('aria-label', 'Capture photo');
  } else {
    $('statusLine').textContent = 'Tap ● to record a pitch — then scrub to the exact frames';
    $('liveReadout').classList.add('hidden');
    $('shutter').setAttribute('aria-label', 'Record');
  }
}

function wire() {
  $('ageSelect').addEventListener('change', (e) => { state.ageId = e.target.value; savePrefs(); if (state.analyzerSpeed || (state.release != null && state.catch != null)) recomputeAnalyzer(); });
  $('modeLive').addEventListener('click', () => setMode('live'));
  $('modeRecord').addEventListener('click', () => setMode('record'));

  $('shutter').addEventListener('click', () => {
    if (state.mode === 'record') {
      if (state.recorder && state.recorder.state === 'recording') stopRecording();
      else startRecording();
    } else {
      // live: grab current frame; tag with last speed if fresh
      const speed = state.lastSpeed || speedFromFlight(distanceForAge(state.ageId), 0.5, state.radarStyle);
      freezeLiveSnapshot(state.lastSpeed || { ...speed, mph: 0 });
      if (!state.lastSpeed) toast('No pitch measured yet — photo saved without a tag.');
    }
  });

  $('importBtn').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) openAnalyzer(URL.createObjectURL(f), f);
    e.target.value = '';
  });
  $('lastBtn').addEventListener('click', () => { if (state.lastSpeed) freezeLiveSnapshot(state.lastSpeed); });

  // live card
  $('liveSave').addEventListener('click', async () => {
    const cv = $('liveSnap');
    const blob = await canvasToBlob(cv, 'image/jpeg', 0.92);
    const name = $('liveCard').dataset.name || 'pitch.jpg';
    await saveOrShare(blob, name, 'Photo');
  });
  $('liveDismiss').addEventListener('click', () => $('liveCard').classList.add('hidden'));

  // analyzer
  $('scrub').addEventListener('input', (e) => {
    const clip = $('clip');
    const dur = clip.duration || 1;
    seekTo((e.target.value / 1000) * dur);
  });
  $('stepBack').addEventListener('click', () => seekTo($('clip').currentTime - state.clipFrameDur));
  $('stepFwd').addEventListener('click', () => seekTo($('clip').currentTime + state.clipFrameDur));
  $('setRelease').addEventListener('click', () => { state.release = $('clip').currentTime; recomputeAnalyzer(); drawAnalyzerOverlay(); });
  $('setCatch').addEventListener('click', () => { state.catch = $('clip').currentTime; recomputeAnalyzer(); drawAnalyzerOverlay(); });
  $('autoDetect').addEventListener('click', () => { $('analyzerNote').textContent = 'Analyzing…'; autoDetect(); });
  $('savePhoto').addEventListener('click', saveAnalyzerPhoto);
  $('saveClip').addEventListener('click', saveAnalyzerClip);
  $('closeAnalyzer').addEventListener('click', closeAnalyzer);

  // sheets
  $('settingsBtn').addEventListener('click', () => $('settingsSheet').classList.remove('hidden'));
  $('closeSettings').addEventListener('click', () => $('settingsSheet').classList.add('hidden'));
  $('infoBtn').addEventListener('click', () => $('helpSheet').classList.remove('hidden'));
  $('closeHelp').addEventListener('click', () => $('helpSheet').classList.add('hidden'));

  const radar = $('radarToggle'); radar.checked = state.radarStyle;
  radar.addEventListener('change', (e) => { state.radarStyle = e.target.checked; savePrefs(); });
  const guide = $('guideToggle'); guide.checked = state.showGuide;
  guide.addEventListener('change', (e) => { state.showGuide = e.target.checked; savePrefs(); $('framingGuide').classList.toggle('hidden', !state.showGuide); });
  const sens = $('sensitivity'); sens.value = state.sensitivity;
  sens.addEventListener('input', (e) => { state.sensitivity = +e.target.value; savePrefs(); if (state.live) state.live.tracker.motionThresh = state.sensitivity; });
}

// ---------- boot ----------
async function boot() {
  loadPrefs();
  populateAges();
  wire();
  setMode('record');
  $('appVersion').textContent = 'Version ' + APP_VERSION;
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    // When a freshly-installed service worker takes control, reload once so the
    // user is never stuck on a stale version of the app.
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  }
  await startCamera();
  // first-run help
  if (!localStorage.getItem('pitchgun.seen')) {
    $('helpSheet').classList.remove('hidden');
    localStorage.setItem('pitchgun.seen', '1');
  }
}
boot();
