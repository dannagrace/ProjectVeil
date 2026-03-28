import type { UnitAnimationState } from "./unit-animation-config.ts";

export type UnitAnimationFallbackVariant = "idle" | "selected" | "hit";
export type UnitAnimationFallbackSource = "unit" | "showcase" | "hero" | "none";

export interface UnitAnimationFallbackSpriteSet<Frame = unknown> {
  idle: Frame | null;
  selected: Frame | null;
  hit: Frame | null;
}

export interface UnitAnimationFallbackAssets<Frame = unknown> {
  heroes: Record<string, Frame | null | undefined>;
  units: Record<string, UnitAnimationFallbackSpriteSet<Frame> | undefined>;
  showcaseUnits: Record<string, UnitAnimationFallbackSpriteSet<Frame> | undefined>;
}

export interface UnitAnimationFallbackSelection<Frame = unknown> {
  variant: UnitAnimationFallbackVariant;
  source: UnitAnimationFallbackSource;
  frame: Frame | null;
}

export function resolveUnitAnimationFallbackVariant(state: UnitAnimationState): UnitAnimationFallbackVariant {
  if (state === "hit" || state === "defeat") {
    return "hit";
  }
  if (state === "move" || state === "attack" || state === "victory") {
    return "selected";
  }
  return "idle";
}

export function resolveUnitAnimationFallbackFrame<Frame>(
  templateId: string,
  state: UnitAnimationState,
  assets: UnitAnimationFallbackAssets<Frame> | null | undefined
): UnitAnimationFallbackSelection<Frame> {
  const variant = resolveUnitAnimationFallbackVariant(state);
  if (!templateId || !assets) {
    return {
      variant,
      source: "none",
      frame: null
    };
  }

  const unitFrames = assets.units[templateId];
  const showcaseFrames = assets.showcaseUnits[templateId];
  const heroFrame = assets.heroes[templateId] ?? null;

  if (unitFrames?.[variant]) {
    return {
      variant,
      source: "unit",
      frame: unitFrames[variant]
    };
  }

  if (showcaseFrames?.[variant]) {
    return {
      variant,
      source: "showcase",
      frame: showcaseFrames[variant]
    };
  }

  if (heroFrame) {
    return {
      variant,
      source: "hero",
      frame: heroFrame
    };
  }

  return {
    variant,
    source: "none",
    frame: null
  };
}
