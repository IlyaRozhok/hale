// The app's backdrop: dark folds of metal, still, drawn once. The grey values are shader constants,
// capped by the token below, so the text on the glass over them stays readable.
import { Skia } from "@shopify/react-native-skia";
import { tokens } from "@hale/tokens";

const hex = tokens.color.backdrop.peak;
const PEAK = (parseInt(hex.slice(1, 3), 16) / 255).toFixed(3);

export const BACKDROP_SKSL = `
uniform float2 r;

float fold(float2 p) {
  float wave = sin(p.x * 2.1 + 0.6) * 0.55 + sin(p.x * 4.3 + 2.2) * 0.22;
  float a = sin((p.y + wave) * 3.4 + 0.8);
  float b = sin((p.y * 1.7 - wave * 1.4) * 2.6 + p.x * 1.1 + 2.0);
  return a * 0.62 + b * 0.38;
}

half4 main(float2 xy) {
  float2 p = xy / r.y * 2.0;
  float e = 0.004;
  float h = fold(p);
  float2 g = float2(fold(p + float2(e, 0.0)) - h, fold(p + float2(0.0, e)) - h) / e;
  float3 n = normalize(float3(-g * 0.34, 1.0));
  float3 l = normalize(float3(-0.35, -0.72, 0.6));
  float diffuse = max(dot(n, l), 0.0);
  float ridge = pow(max(dot(n, normalize(l + float3(0.0, 0.0, 1.0))), 0.0), 48.0);
  float sheen = pow(diffuse, 3.0) * 0.34 + ridge * 0.72;
  // Black at the top, the folds gather further down, as if lit from below.
  float2 uv = xy / r;
  float gather = smoothstep(0.02, 0.62, uv.y);
  float floorGlow = smoothstep(0.55, 1.05, uv.y) * smoothstep(1.2, 0.0, uv.x) * 0.14;
  float v = 0.035 + sheen * gather + floorGlow;
  v = min(v, ${PEAK});
  return half4(half3(v), 1.0);
}
`;

const made = Skia.RuntimeEffect.Make(BACKDROP_SKSL);
if (!made) throw new Error("backdrop shader failed to compile");
export const backdropEffect = made;
