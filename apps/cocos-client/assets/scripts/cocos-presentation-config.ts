import presentationConfigJson from "../../../../configs/cocos-presentation.json";
import {
  createUnitAnimationNameMap,
  type UnitAnimationNameMap,
  type UnitAnimationTimingMap
} from "./unit-animation-config.ts";

export type CocosPresentationWaveform = "sine" | "square" | "sawtooth" | "triangle";
export type CocosMusicScene = "explore" | "battle";
export type CocosAudioCue = "attack" | "skill" | "hit" | "victory" | "defeat" | "level_up";
export type CocosPresentationAssetStage = "placeholder" | "production";
export type CocosAnimationDeliveryMode = "fallback" | "clip" | "spine";

export interface CocosPresentationNote {
  frequency: number;
  durationMs: number;
}

export interface CocosPresentationSequence {
  waveform: CocosPresentationWaveform;
  gain: number;
  attackMs: number;
  releaseMs: number;
  gapMs: number;
  loopGapMs: number;
  assetPath: string;
  assetStage: CocosPresentationAssetStage;
  assetVolume: number;
  notes: CocosPresentationNote[];
}

export interface CocosAnimationProfile {
  fallbackPrefix: string;
  spinePrefix: string;
  clipPrefix: string;
  deliveryMode: CocosAnimationDeliveryMode;
  assetStage: CocosPresentationAssetStage;
  spineNames: UnitAnimationNameMap;
  clipNames: UnitAnimationNameMap;
  returnTimings: UnitAnimationTimingMap;
  returnToIdleAfterOneShot: boolean;
}

export interface CocosPresentationConfig {
  animationProfiles: Record<string, CocosAnimationProfile>;
  audio: {
    music: Record<CocosMusicScene, CocosPresentationSequence>;
    cues: Record<CocosAudioCue, CocosPresentationSequence>;
  };
  loadingBudget: {
    targetMs: number;
    hardLimitMs: number;
    preloadGroups: {
      boot: string[];
      battle: string[];
    };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function clampNumber(value: unknown, fallback: number, min = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min ? value : fallback;
}

function normalizeWaveform(value: unknown, fallback: CocosPresentationWaveform): CocosPresentationWaveform {
  return value === "sine" || value === "square" || value === "sawtooth" || value === "triangle" ? value : fallback;
}

function normalizeAssetStage(value: unknown, fallback: CocosPresentationAssetStage): CocosPresentationAssetStage {
  return value === "placeholder" || value === "production" ? value : fallback;
}

function normalizeAnimationDeliveryMode(value: unknown, fallback: CocosAnimationDeliveryMode): CocosAnimationDeliveryMode {
  return value === "fallback" || value === "clip" || value === "spine" ? value : fallback;
}

function normalizeNotes(value: unknown, fallbackFrequency: number): CocosPresentationNote[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [{ frequency: fallbackFrequency, durationMs: 120 }];
  }

  return value.map((entry, index) => {
    const note = isRecord(entry) ? entry : {};
    return {
      frequency: clampNumber(note.frequency, fallbackFrequency + index * 36, 1),
      durationMs: clampNumber(note.durationMs, 120, 20)
    };
  });
}

function normalizeSequence(value: unknown, fallback: Partial<CocosPresentationSequence> & Pick<CocosPresentationSequence, "waveform">): CocosPresentationSequence {
  const record = isRecord(value) ? value : {};
  return {
    waveform: normalizeWaveform(record.waveform, fallback.waveform),
    gain: clampNumber(record.gain, fallback.gain ?? 0.04, 0.001),
    attackMs: clampNumber(record.attackMs, fallback.attackMs ?? 12, 1),
    releaseMs: clampNumber(record.releaseMs, fallback.releaseMs ?? 90, 1),
    gapMs: clampNumber(record.gapMs, fallback.gapMs ?? 0, 0),
    loopGapMs: clampNumber(record.loopGapMs, fallback.loopGapMs ?? 0, 0),
    assetPath: typeof record.assetPath === "string" ? record.assetPath : fallback.assetPath ?? "",
    assetStage: normalizeAssetStage(record.assetStage, fallback.assetStage ?? "placeholder"),
    assetVolume: clampNumber(record.assetVolume, fallback.assetVolume ?? 0.72, 0.01),
    notes: normalizeNotes(record.notes, fallback.notes?.[0]?.frequency ?? 220)
  };
}

function normalizeNameMap(value: unknown): UnitAnimationNameMap {
  const record = isRecord(value) ? value : {};
  return createUnitAnimationNameMap({
    idle: typeof record.idle === "string" ? record.idle : "",
    move: typeof record.move === "string" ? record.move : "",
    attack: typeof record.attack === "string" ? record.attack : "",
    hit: typeof record.hit === "string" ? record.hit : "",
    victory: typeof record.victory === "string" ? record.victory : "",
    defeat: typeof record.defeat === "string" ? record.defeat : ""
  });
}

function normalizeAnimationProfile(value: unknown, fallbackPrefix: string): CocosAnimationProfile {
  const record = isRecord(value) ? value : {};
  return {
    fallbackPrefix: typeof record.fallbackPrefix === "string" && record.fallbackPrefix.trim() ? record.fallbackPrefix : fallbackPrefix,
    spinePrefix: typeof record.spinePrefix === "string" ? record.spinePrefix : "",
    clipPrefix: typeof record.clipPrefix === "string" ? record.clipPrefix : "",
    deliveryMode: normalizeAnimationDeliveryMode(record.deliveryMode, "fallback"),
    assetStage: normalizeAssetStage(record.assetStage, "placeholder"),
    spineNames: normalizeNameMap(record.spineNames),
    clipNames: normalizeNameMap(record.clipNames),
    returnTimings: {
      attack: clampNumber(isRecord(record.returnTimings) ? record.returnTimings.attack : undefined, 0.45, 0),
      hit: clampNumber(isRecord(record.returnTimings) ? record.returnTimings.hit : undefined, 0.25, 0),
      victory: clampNumber(isRecord(record.returnTimings) ? record.returnTimings.victory : undefined, 0.8, 0),
      defeat: clampNumber(isRecord(record.returnTimings) ? record.returnTimings.defeat : undefined, 0.8, 0)
    },
    returnToIdleAfterOneShot: record.returnToIdleAfterOneShot !== false
  };
}

function normalizeConfig(value: unknown): CocosPresentationConfig {
  const record = isRecord(value) ? value : {};
  const animationProfiles = isRecord(record.animationProfiles) ? record.animationProfiles : {};
  const audio = isRecord(record.audio) ? record.audio : {};
  const music = isRecord(audio.music) ? audio.music : {};
  const cues = isRecord(audio.cues) ? audio.cues : {};
  const loadingBudget = isRecord(record.loadingBudget) ? record.loadingBudget : {};
  const preloadGroups = isRecord(loadingBudget.preloadGroups) ? loadingBudget.preloadGroups : {};

  return {
    animationProfiles: {
      hero_guard_basic: normalizeAnimationProfile(animationProfiles.hero_guard_basic, "Guard"),
      wolf_pack: normalizeAnimationProfile(animationProfiles.wolf_pack, "Wolf")
    },
    audio: {
      music: {
        explore: normalizeSequence(music.explore, {
          waveform: "triangle",
          assetPath: "audio/explore-loop",
          assetStage: "placeholder",
          assetVolume: 0.54,
          notes: [{ frequency: 261.63, durationMs: 220 }]
        }),
        battle: normalizeSequence(music.battle, {
          waveform: "sawtooth",
          assetPath: "audio/battle-loop",
          assetStage: "placeholder",
          assetVolume: 0.58,
          notes: [{ frequency: 196, durationMs: 180 }]
        })
      },
      cues: {
        attack: normalizeSequence(cues.attack, {
          waveform: "square",
          assetPath: "audio/attack",
          assetStage: "placeholder",
          assetVolume: 0.74,
          notes: [{ frequency: 320, durationMs: 80 }]
        }),
        skill: normalizeSequence(cues.skill, {
          waveform: "triangle",
          assetPath: "audio/skill",
          assetStage: "placeholder",
          assetVolume: 0.76,
          notes: [{ frequency: 392, durationMs: 90 }]
        }),
        hit: normalizeSequence(cues.hit, {
          waveform: "sawtooth",
          assetPath: "audio/hit",
          assetStage: "placeholder",
          assetVolume: 0.66,
          notes: [{ frequency: 180, durationMs: 120 }]
        }),
        victory: normalizeSequence(cues.victory, {
          waveform: "triangle",
          assetPath: "audio/level-up",
          assetStage: "placeholder",
          assetVolume: 0.78,
          notes: [{ frequency: 587.33, durationMs: 120 }]
        }),
        defeat: normalizeSequence(cues.defeat, {
          waveform: "sawtooth",
          assetPath: "audio/hit",
          assetStage: "placeholder",
          assetVolume: 0.72,
          notes: [{ frequency: 146.83, durationMs: 140 }]
        }),
        level_up: normalizeSequence(cues.level_up, {
          waveform: "triangle",
          assetPath: "audio/level-up",
          assetStage: "placeholder",
          assetVolume: 0.82,
          notes: [{ frequency: 523.25, durationMs: 90 }]
        })
      }
    },
    loadingBudget: {
      targetMs: clampNumber(loadingBudget.targetMs, 1800, 1),
      hardLimitMs: clampNumber(loadingBudget.hardLimitMs, 3000, 1),
      preloadGroups: {
        boot: Array.isArray(preloadGroups.boot) ? preloadGroups.boot.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [],
        battle: Array.isArray(preloadGroups.battle) ? preloadGroups.battle.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : []
      }
    }
  };
}

export const cocosPresentationConfig = normalizeConfig(presentationConfigJson);
const defaultAnimationProfile = cocosPresentationConfig.animationProfiles.hero_guard_basic ?? normalizeAnimationProfile({}, "Guard");

export function resolveUnitAnimationProfile(templateId: string): CocosAnimationProfile {
  return cocosPresentationConfig.animationProfiles[templateId] ?? defaultAnimationProfile;
}
