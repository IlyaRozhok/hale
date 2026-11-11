// SkSL port of the fragment shader of the liquid-metal mockup (removed from docs on 2026-11-11; see git history).
// One surface function (height + chrome reflection); `pool` adds the mercury waterline.
// The grey values below are shader constants, not UI colours.
import { Skia } from "@shopify/react-native-skia";

export const METAL_SKSL = `
uniform float2 r;
uniform float t;
uniform float level;
uniform float pool;

float hash(float2 p) { return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }

float noise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + float2(1.0, 0.0)), f.x),
             mix(hash(i + float2(0.0, 1.0)), hash(i + float2(1.0, 1.0)), f.x), f.y);
}

float fbm(float2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.02 + 7.3;
    a *= 0.5;
  }
  return v;
}

float height(float2 p) {
  float2 q = float2(fbm(p + t * 0.07), fbm(p + float2(5.2, 1.3) - t * 0.06));
  return fbm(p + 2.4 * q);
}

half4 main(float2 fragCoord) {
  // GLSL's gl_FragCoord is bottom-up; Skia's is top-down.
  float2 uv = float2(fragCoord.x / r.x, 1.0 - fragCoord.y / r.y);
  float2 p = uv * float2(r.x / r.y, 1.0) * 2.2;
  float e = 0.012;
  float h = height(p);
  float3 n = normalize(float3((h - height(p + float2(e, 0.0))) / e * 0.55,
                              (h - height(p + float2(0.0, e))) / e * 0.55, 1.0));
  // Chrome: a banded studio reflection indexed by the surface normal.
  float m = n.y * 0.5 + 0.5 + n.x * 0.18;
  float bands = 0.5 + 0.5 * sin(m * 15.0 + h * 7.0);
  float c = mix(0.06, 0.98, pow(bands, 1.7));
  c = mix(c, smoothstep(0.2, 0.8, m), 0.28);
  float spec = pow(max(dot(n, normalize(float3(-0.35, 0.55, 0.76))), 0.0), 48.0);
  c = min(c + spec * 0.9, 1.0);
  float3 col = float3(c) * float3(0.97, 0.985, 1.0);
  float a = 1.0;
  if (pool > 0.5) {
    // Nothing left: without this the waves would still peek above the bottom edge.
    if (level <= 0.001) return half4(0.0);
    float wave = level + 0.018 * sin(uv.x * 7.0 + t * 0.9) + 0.012 * sin(uv.x * 13.0 - t * 0.7);
    a = smoothstep(wave, wave - 0.006, uv.y);
    // Bright meniscus along the surface line.
    col = mix(col, float3(1.0), smoothstep(wave - 0.02, wave - 0.004, uv.y) * a * 0.75);
  }
  return half4(half3(col * a), half(a));
}
`;

const effect = Skia.RuntimeEffect.Make(METAL_SKSL);
if (!effect) throw new Error("metal.sksl: shader failed to compile");

export const metalEffect = effect;
