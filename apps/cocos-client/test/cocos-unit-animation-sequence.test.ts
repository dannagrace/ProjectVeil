import assert from "node:assert/strict";
import test from "node:test";
import { resolveUnitAnimationFrameSequence } from "../assets/scripts/cocos-unit-animation-sequence";

test("unit animation sequence prefers unit frames and builds multi-frame loops for idle", () => {
  const sequence = resolveUnitAnimationFrameSequence("hero_guard_basic", "idle", {
    heroes: {
      hero_guard_basic: "hero"
    },
    units: {
      hero_guard_basic: {
        idle: "idle",
        selected: "selected",
        hit: "hit",
        frame: "frame"
      }
    },
    showcaseUnits: {}
  });

  assert.deepEqual(sequence, {
    frames: ["idle", "frame", "idle"],
    frameDurationSeconds: 0.32,
    loop: true,
    source: "unit"
  });
});

test("unit animation sequence falls back to showcase frames when unit frames are missing", () => {
  const sequence = resolveUnitAnimationFrameSequence("sunlance_knight", "attack", {
    heroes: {},
    units: {},
    showcaseUnits: {
      sunlance_knight: {
        idle: "showcase-idle",
        selected: "showcase-selected",
        hit: "showcase-hit",
        frame: "showcase-frame"
      }
    }
  });

  assert.deepEqual(sequence, {
    frames: ["showcase-selected", "showcase-hit", "showcase-frame"],
    frameDurationSeconds: 0.11,
    loop: false,
    source: "showcase"
  });
});

test("unit animation sequence keeps hero portrait as a single-frame safety downgrade", () => {
  const sequence = resolveUnitAnimationFrameSequence("hero_ranger_serin", "hit", {
    heroes: {
      hero_ranger_serin: "portrait"
    },
    units: {},
    showcaseUnits: {}
  });

  assert.deepEqual(sequence, {
    frames: ["portrait"],
    frameDurationSeconds: 0.14,
    loop: false,
    source: "hero"
  });
});

test("unit animation sequence returns none when the template has no art", () => {
  const sequence = resolveUnitAnimationFrameSequence("missing", "defeat", {
    heroes: {},
    units: {},
    showcaseUnits: {}
  });

  assert.deepEqual(sequence, {
    frames: [],
    frameDurationSeconds: 0.2,
    loop: false,
    source: "none"
  });
});
