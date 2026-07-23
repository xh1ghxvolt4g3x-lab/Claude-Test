// Pitcher profiles + pitch history, persisted in localStorage.
// A "pitch" is { mph, t (ms epoch), ageId, distanceFt, source }.

const KEY = 'pitchgun.pitchers';

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
}
function write(d) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* quota */ }
}
function uid() { return 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1000); }

export const Store = {
  data: null,

  init() {
    let d = read();
    if (!d || !d.pitchers || !Object.keys(d.pitchers).length) {
      const id = uid();
      d = { currentId: id, pitchers: { [id]: { id, name: 'Pitcher 1', created: Date.now(), pitches: [] } } };
    }
    if (!d.currentId || !d.pitchers[d.currentId]) d.currentId = Object.keys(d.pitchers)[0];
    this.data = d; write(d);
    return this;
  },

  current() { return this.data.pitchers[this.data.currentId]; },
  list() { return Object.values(this.data.pitchers).sort((a, b) => a.created - b.created); },

  add(name) {
    const id = uid();
    this.data.pitchers[id] = { id, name: name || `Pitcher ${this.list().length + 1}`, created: Date.now(), pitches: [] };
    this.data.currentId = id; write(this.data);
    return this.data.pitchers[id];
  },
  rename(id, name) { if (this.data.pitchers[id] && name) { this.data.pitchers[id].name = name; write(this.data); } },
  remove(id) {
    delete this.data.pitchers[id];
    if (!Object.keys(this.data.pitchers).length) return this.init();
    if (this.data.currentId === id) this.data.currentId = this.list()[0].id;
    write(this.data);
  },
  select(id) { if (this.data.pitchers[id]) { this.data.currentId = id; write(this.data); } },
  clearPitches(id) { const p = this.data.pitchers[id]; if (p) { p.pitches = []; write(this.data); } },

  logPitch(pitch) {
    const p = this.current();
    if (!p) return;
    p.pitches.push({ mph: Math.round(pitch.mph * 10) / 10, t: Date.now(), ageId: pitch.ageId, distanceFt: pitch.distanceFt, source: pitch.source || 'live' });
    // keep history bounded
    if (p.pitches.length > 2000) p.pitches = p.pitches.slice(-2000);
    write(this.data);
    return p;
  },

  stats(id) {
    const p = this.data.pitchers[id || this.data.currentId];
    if (!p || !p.pitches.length) return { count: 0, todayCount: 0, max: 0, avg: 0, todayMax: 0, todayAvg: 0, recent: [] };
    const speeds = p.pitches.map((x) => x.mph);
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const today = p.pitches.filter((x) => x.t >= startOfDay).map((x) => x.mph);
    const sum = (a) => a.reduce((s, v) => s + v, 0);
    return {
      count: speeds.length,
      max: Math.max(...speeds),
      avg: sum(speeds) / speeds.length,
      todayCount: today.length,
      todayMax: today.length ? Math.max(...today) : 0,
      todayAvg: today.length ? sum(today) / today.length : 0,
      recent: p.pitches.slice(-20),
    };
  },
};
