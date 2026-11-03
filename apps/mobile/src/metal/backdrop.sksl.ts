// The app's backdrop: long dark folds of metal, still, drawn once. The grey values are shader constants,
// capped by the token below, so the text on the glass over them stays readable.
import { Skia } from "@shopify/react-native-skia";
import { tokens } from "@hale/tokens";

const grey = (hex: string) => (parseInt(hex.slice(1, 3), 16) / 255).toFixed(3);
const PEAK = grey(tokens.color.backdrop.peak);
const SHEET = grey(tokens.color.backdrop.sheet);

export const BACKDROP_SKSL = `
uniform float2 r;

// One long fold: x is its thin bright crest on the curve, y the soft sheet of light falling away below it.
float2 ribbon(float2 p, float base, float a1, float f1, float ph1, float a2, float f2, float ph2, float fall, float bright) {
  float y = base + a1 * sin(p.x * f1 + ph1) + a2 * sin(p.x * f2 + ph2);
  float d = p.y - y;
  float along = 0.3 + 0.7 * pow(0.5 + 0.5 * sin(p.x * f1 * 0.9 + ph2), 2.0);
  float crest = exp(-d * d / (0.00010 + 0.00018 * along)) * along;
  float halo = exp(-d * d / 0.0028) * along * 0.16;
  float sheet = smoothstep(-0.002, 0.012, d) * exp(-max(d, 0.0) / fall) * (0.1 + 0.12 * along);
  return float2(crest, halo + sheet) * bright;
}

half4 main(float2 xy) {
  float2 p = float2(xy.x / r.x * 2.4, xy.y / r.y);
  float2 v = ribbon(p, 0.25, 0.03, 2.1, 1.2, 0.01, 4.7, 3.0, 0.14, 0.34);
  v += ribbon(p, 0.42, 0.045, 1.7, 3.4, 0.014, 5.3, 0.4, 0.12, 0.6);
  v += ribbon(p, 0.56, 0.035, 2.3, 0.4, 0.012, 5.1, 1.9, 0.16, 0.5);
  v += ribbon(p, 0.70, 0.05, 1.9, 2.1, 0.016, 4.3, 0.7, 0.12, 0.95);
  v += ribbon(p, 0.86, 0.04, 2.6, 4.0, 0.014, 5.7, 2.8, 0.14, 0.8);
  // A dim glow from below on the left, as the light falls off into the corner.
  float wide = v.y + smoothstep(0.72, 1.05, p.y) * smoothstep(2.4, 0.0, p.x) * 0.12;
  float grey = 0.022 + min(wide, ${SHEET});
  grey = min(grey + v.x, ${PEAK});
  return half4(half3(grey), 1.0);
}
`;

const made = Skia.RuntimeEffect.Make(BACKDROP_SKSL);
if (!made) throw new Error("backdrop shader failed to compile");
export const backdropEffect = made;
