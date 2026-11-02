# Liquid metal prototype notes (Task 14)

Status: code and shader written, not yet run on a device. The owner gate (step 5) is open.

## What was built

- `apps/mobile` (`@tablo/mobile`): Expo SDK 58, React Native 0.88, `@shopify/react-native-skia` 2.14, Reanimated 4, iOS only, dev client, bundle id `com.irozhok.tablo`.
- `src/metal/metal.sksl.ts`: SkSL port of the mockup shader. One surface function (domain-warped fbm height, banded chrome reflection, specular); `pool` adds the mercury waterline and meniscus. Y is flipped because SkSL is top-down.
- `Mercury.tsx` (mockup A) and `Ring.tsx` (mockup C, the same shader masked by a round-capped arc over a `data.track` ring). `LimitVisual` selects the mode.
- `level.ts`: pure maths (clamp, NaN to 0, wave, shader time, frame-rate independent level easing), unit tested in node.
- Half resolution: the Skia canvas is width/2 by height/2 and scaled 2x about its centre by the compositor, so the shader runs on a quarter of the pixels (`HalfResCanvas.tsx`).
- Pause: the Reanimated frame callback is stopped when the app is not `active` or reduce-motion is on. No frames are produced then; a level change still redraws once. Under reduce-motion the shader time is frozen at a fixed pose.

## Verified

- `level.ts` unit tests (13) pass; root typecheck, lint, test (340), `check:colors`, `infra/verify-bundle.sh` pass.
- The SkSL compiles and renders: checked headlessly with CanvasKit (Skia WASM) `RuntimeEffect.Make`, with four uniforms and sane pixels (transparent above the waterline, metal below). Previews: `.superpowers/sdd/2026-11-02-tablo-foundation-to-today/task-14-sksl-*-canvaskit.png`. CanvasKit is the same Skia SkSL compiler but not the iOS Metal backend, so this is evidence, not proof.
- `npx expo prebuild --platform ios` generates `ios/` (git-ignored).

## Not verified

- No build or run on the simulator: `expo run:ios` needs CocoaPods, which is not installed on this machine (Expo tried to install it through Homebrew; that was stopped, since it changes the system). Run `brew install cocoapods` (or `gem install cocoapods`), then `cd apps/mobile && npx expo run:ios`.
- Metro with the pnpm isolated layout is untested. If Metro or `pod install` cannot resolve packages, add `node-linker=hoisted` to `.npmrc`, reinstall, and re-run `infra/verify-bundle.sh` and the API tests. Not applied now because nothing showed it was needed.
- Frame rate, heat, battery: simulator numbers are meaningless and none were taken.
- Ring arc direction and round-cap look at level 0, Mask over a shader, and the half-res scale seam are only checked by reading, not by eye.

## Owner checklist (real iPhone, step 5)

1. Build the dev client on the phone, open the demo screen, test both modes with the slider.
2. Xcode Instruments (Core Animation FPS), 60 s: at least 55 fps.
3. 10 minutes on the screen: heat and battery use not noticeably different from an ordinary app.
4. Look is comparable to `docs/superpowers/mockups/liquid-metal.html` (A and C).
5. Background the app and turn on Reduce Motion: metal must stop (watch Instruments: no frames).

Fallback order if it fails: (1) lower the resolution further (`SCALE` in `HalfResCanvas.tsx`) and cap at 30 fps; (2) static metal rendered once, redrawn only when the level changes (already the behaviour when `running` is false). Record the outcome below.

Result: pending.
