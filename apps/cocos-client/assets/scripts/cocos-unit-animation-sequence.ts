import type { UnitAnimationFallbackSource } from "./cocos-unit-animation-fallback.ts";
import { shouldLoopUnitAnimation, type UnitAnimationState } from "./unit-animation-config.ts";

export interface UnitAnimationSequenceSpriteSet<Frame = unknown> {
  idle: Frame | null;
  selected: Frame | null;
  hit: Frame | null;
  frame: Frame | null;
}

export interface UnitAnimationSequenceAssets<Frame = unknown> {
  heroes: Record<string, Frame | null | undefined>;
  units: Record<string, UnitAnimationSequenceSpriteSet<Frame> | undefined>;
  showcaseUnits: Record<string, UnitAnimationSequenceSpriteSet<Frame> | undefined>;
}

export interface UnitAnimationFrameSequence<Frame = unknown> {
  frames: Frame[];
  frameDurationSeconds: number;
  loop: boolean;
  source: UnitAnimationFallbackSource;
}

const STATE_FRAME_DURATION_SECONDS: Record<UnitAnimationState, number> = {
  idle: 0.32,
  move: 0.14,
  attack: 0.11,
  hit: 0.14,
  victory: 0.18,
  defeat: 0.2
};

export function resolveUnitAnimationFrameSequence<Frame>(
  templateId: string,
  state: UnitAnimationState,
  assets: UnitAnimationSequenceAssets<Frame> | null | undefined
): UnitAnimationFrameSequence<Frame> {
  const loop = shouldLoopUnitAnimation(state);
  const frameDurationSeconds = STATE_FRAME_DURATION_SECONDS[state];

  if (!templateId || !assets) {
    return {
      frames: [],
      frameDurationSeconds,
      loop,
      source: "none"
    };
  }

  const unitFrames = assets.units[templateId];
  if (unitFrames) {
    return {
      frames: buildStateSequence(unitFrames, state),
      frameDurationSeconds,
      loop,
      source: "unit"
    };
  }

  const showcaseFrames = assets.showcaseUnits[templateId];
  if (showcaseFrames) {
    return {
      frames: buildStateSequence(showcaseFrames, state),
      frameDurationSeconds,
      loop,
      source: "showcase"
    };
  }

  const heroFrame = assets.heroes[templateId] ?? null;
  return {
    frames: heroFrame ? [heroFrame] : [],
    frameDurationSeconds,
    loop,
    source: heroFrame ? "hero" : "none"
  };
}

function buildStateSequence<Frame>(
  spriteSet: UnitAnimationSequenceSpriteSet<Frame>,
  state: UnitAnimationState
): Frame[] {
  switch (state) {
    case "idle":
      return compactFrames([spriteSet.idle, spriteSet.frame, spriteSet.idle]);
    case "move":
      return compactFrames([spriteSet.selected, spriteSet.frame, spriteSet.selected]);
    case "attack":
      return compactFrames([spriteSet.selected, spriteSet.hit, spriteSet.frame]);
    case "hit":
      return compactFrames([spriteSet.hit, spriteSet.idle]);
    case "victory":
      return compactFrames([spriteSet.selected, spriteSet.frame, spriteSet.idle]);
    case "defeat":
      return compactFrames([spriteSet.hit, spriteSet.frame, spriteSet.hit]);
    default:
      return compactFrames([spriteSet.idle]);
  }
}

function compactFrames<Frame>(frames: Array<Frame | null | undefined>): Frame[] {
  const result: Frame[] = [];
  for (const frame of frames) {
    if (!frame) {
      continue;
    }
    if (result[result.length - 1] === frame) {
      continue;
    }
    result.push(frame);
  }
  return result;
}
