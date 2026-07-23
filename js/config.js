// Static configuration and physics constants for PitchGun.

// Official fastpitch softball pitching distances (rubber to the front of home
// plate). These are the distances the ball travels from release to the plate
// and are what turn a flight time into a speed.
export const AGE_GROUPS = [
  { id: '10U', label: '10U', distanceFt: 35, note: '35 ft' },
  { id: '12U', label: '12U', distanceFt: 40, note: '40 ft' },
  { id: '14+', label: '14U+', distanceFt: 43, note: '43 ft' },
];

export const DEFAULT_AGE = '12U';

// feet-per-second -> miles-per-hour
export const FPS_TO_MPH = 3600 / 5280; // 0.681818...

// The measured value is the AVERAGE speed over the flight. A softball bleeds a
// few mph to drag between release and the plate, so radar guns (which read the
// ball right out of the hand) show a slightly higher number. This factor is an
// approximate uplift to estimate that release speed. It is intentionally
// conservative and is only applied when the user turns on "radar-style".
export const RELEASE_SPEED_FACTOR = 1.05;

// Camera constraints we *ask* for. iOS will clamp frame rate to whatever the
// web layer allows (typically 30 or 60), but asking high does no harm.
export const CAMERA_CONSTRAINTS = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 240, min: 30 },
  },
};

export function distanceForAge(ageId) {
  const g = AGE_GROUPS.find((a) => a.id === ageId);
  return (g || AGE_GROUPS[1]).distanceFt;
}

// Core physics: distance (ft) and flight time (s) -> speed report.
// `calibration` is a user-set multiplier (default 1) to match a known radar gun.
export function speedFromFlight(distanceFt, flightSeconds, radarStyle, calibration = 1) {
  if (!flightSeconds || flightSeconds <= 0) return null;
  const fps = distanceFt / flightSeconds;
  let mph = fps * FPS_TO_MPH;
  if (radarStyle) mph *= RELEASE_SPEED_FACTOR;
  mph *= (calibration || 1);
  return {
    mph,
    fps,
    flightSeconds,
    distanceFt,
    radarStyle: !!radarStyle,
    calibration: calibration || 1,
  };
}
