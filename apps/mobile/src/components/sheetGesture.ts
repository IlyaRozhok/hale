// When a sheet follows the finger and when letting go closes it. No native imports: runs in node tests.

const START = 8;
const CLOSE_DISTANCE = 120;
const CLOSE_SPEED = 0.8;
const FLICK_MIN = 20;

export function shouldDragSheet(move: { dx: number; dy: number }, scrollTop: number): boolean {
  return scrollTop <= 0 && move.dy > START && move.dy > Math.abs(move.dx);
}

export function shouldCloseSheet(release: { dy: number; vy: number }): boolean {
  return release.dy > CLOSE_DISTANCE || (release.dy > FLICK_MIN && release.vy > CLOSE_SPEED);
}
