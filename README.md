# PitchGun — Softball Pitch Speed

A phone-first web app (PWA) that turns your iPhone into a pitch-speed gun for
fastpitch softball. Open it and it's already pointed at the pitching lane in the
right mode. It reads speed **live** as pitches happen, or from a **recorded** /
**imported slow‑mo** clip that you can scrub frame‑by‑frame for a precise number.
Save any pitch as a photo with the speed **tagged in the corner**.

<p align="center"><img src="icons/icon-192.png" width="96" alt="PitchGun icon"></p>

## How it measures speed

There's no radar in a phone, so PitchGun uses **time‑of‑flight physics**:

```
speed = pitching distance ÷ flight time
```

You pick the age group; the app knows the official distance from the rubber to
the plate:

| Age group | Pitching distance |
|-----------|-------------------|
| **10U**   | 35 ft             |
| **12U**   | 40 ft             |
| **14U+**  | 43 ft             |

The flight time comes from real video‑frame timestamps (not your reaction time),
so it's robust: a pitch lasts roughly half a second, which is ~15–30 frames even
at ordinary web frame rates.

The number shown is the **average speed over the flight**. Radar guns read the
ball right out of the hand, which is a few mph faster (the ball bleeds speed to
drag). Turn on **Radar‑style** in Settings to add an approximate uplift for that.

## The three ways to get a reading

1. **Live** (default) — camera on, pitches are detected and timed automatically.
   Convenient; accuracy is bounded by the browser's camera frame rate.
2. **Record** — tap the shutter to capture a clip, then it opens in the analyzer
   where you can nudge the exact release/catch frames.
3. **Import** — for the sharpest timing, shoot a **slow‑motion clip in the
   iPhone Camera app** (240 fps) and Import it here, then set the exact frames.

Ball detection is tuned for softballs: it looks for the **optic‑yellow** ball
(with a bright‑white fallback) that has **moved** since the previous frame, so
it locks onto the ball rather than the pitcher's body.

## Setup on your iPhone

The camera only works over **HTTPS** (or `localhost`). This repo **auto‑deploys
to GitHub Pages** — a workflow (`.github/workflows/deploy-pages.yml`) publishes
the app every time `main` changes. One‑time setup:

1. In the repo on GitHub: **Settings ▸ Pages ▸ Build and deployment**, set
   **Source = GitHub Actions**. (You only do this once.)
2. Merge the app to `main` (the pull request does this). The **Actions** tab
   will show a "Deploy to GitHub Pages" run; when it finishes it prints the live
   `https://…github.io/…/` URL.
3. Open that URL in **Safari** on the iPhone.
4. Tap **Share ▸ Add to Home Screen**. Launch it from the home‑screen icon so it
   runs full‑screen and is ready to record.
5. Allow the camera when prompted (Settings ▸ Safari ▸ Camera if you miss it).

Any static HTTPS host works too (Netlify, Vercel, Cloudflare Pages, `python3 -m
http.server` behind HTTPS for local testing).

## Getting an accurate reading

- **Stand to the side** of the lane, near the midpoint, 15–25 ft back.
- **Frame the whole flight** — pitcher near one edge, catcher near the other. The
  full pitching distance must be in view (that's the distance the math uses).
- Hold steady; bright, even lighting helps the ball stand out.
- For Record/Import, use the frame‑step buttons to land **Release** on the frame
  the ball leaves the hand and **Catch** on the frame it hits the glove.

## Saving

- **Save Photo** writes a full‑resolution still of the chosen frame with the
  speed, age group, and distance tagged in the corner.
- **Save Clip** re‑encodes the pitch with the speed burned in.
- On iOS the share sheet opens — choose **Save Image / Save Video** to put it in
  Photos.

## Honest limitations

- **Web browsers can't access the iPhone's native 240 fps slow‑mo pipeline.**
  `getUserMedia` gives a normal ~30/60 fps stream, so Live mode's resolution is
  limited by that. For best accuracy, Import a real slow‑mo clip.
- Imported clips must play in **real time**. Apple "slow‑mo" videos that are
  *presented* slowed can stretch the timeline; a constant‑frame‑rate export or a
  normally‑recorded clip is safest.
- Auto‑detection is best‑effort and depends on framing, lighting, and a
  visible ball; the frame‑by‑frame scrubber is the fallback that's always exact.

## Project layout

```
index.html              app shell / UI
css/styles.css          styles
js/config.js            distances + speed physics
js/tracker.js           softball ball detection + flight detection
js/app.js               camera, live/record/import, analyzer, tagged save
manifest.webmanifest    PWA manifest (installable, standalone)
sw.js                   offline app‑shell cache
icons/                  app icons
scripts/generate_icons.py   regenerates the icons (needs Pillow)
```

No build step and no dependencies — it's plain ES modules. To run locally over
HTTPS for camera testing, serve the folder from any static server with TLS.
