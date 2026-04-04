import assert from "node:assert/strict";
import test from "node:test";
import { createCocosAudioRuntime } from "../assets/scripts/cocos-audio-runtime";
import { cocosPresentationConfig } from "../assets/scripts/cocos-presentation-config";

async function flushAsyncAudioTick(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

test("audio runtime keeps scene and cue state when AudioContext is unavailable", () => {
  const scheduled: Array<() => void> = [];
  const runtime = createCocosAudioRuntime(cocosPresentationConfig.audio, {
    setTimeout: ((handler: (...args: unknown[]) => void) => {
      scheduled.push(() => handler());
      return { id: scheduled.length } as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
    clearTimeout: (() => undefined) as typeof clearTimeout
  });

  assert.deepEqual(runtime.getState(), {
    supported: false,
    assetBacked: false,
    unlocked: false,
    currentScene: null,
    lastCue: null,
    cueCount: 0,
    musicMode: "idle",
    cueMode: "idle",
    bgmVolume: 100,
    sfxVolume: 100
  });

  runtime.setScene("explore");
  runtime.playCue("attack");
  assert.equal(runtime.getState().supported, false);
  assert.equal(runtime.getState().assetBacked, false);
  assert.equal(runtime.getState().currentScene, "explore");
  assert.equal(runtime.getState().lastCue, "attack");
  assert.equal(runtime.getState().cueCount, 1);
  assert.equal(runtime.getState().musicMode, "synth");
  assert.equal(runtime.getState().cueMode, "idle");
  assert.equal(scheduled.length, 1);

  runtime.setScene("battle");
  assert.equal(runtime.getState().currentScene, "battle");

  runtime.dispose();
  assert.equal(runtime.getState().currentScene, null);
});

test("audio runtime waits for a user gesture before creating WebAudio context", () => {
  const starts: number[] = [];
  const stops: number[] = [];
  let resumeCount = 0;
  let audioContextCount = 0;
  const runtime = createCocosAudioRuntime(cocosPresentationConfig.audio, {
    AudioContext: class {
      currentTime = 0;
      state = "suspended";
      destination = {};

      constructor() {
        audioContextCount += 1;
      }

      createOscillator() {
        return {
          type: "triangle" as OscillatorType,
          frequency: {
            setValueAtTime: () => undefined
          },
          connect: () => undefined,
          start: (time = 0) => {
            starts.push(time);
          },
          stop: (time = 0) => {
            stops.push(time);
          },
          onended: null
        };
      }

      createGain() {
        return {
          gain: {
            setValueAtTime: () => undefined,
            linearRampToValueAtTime: () => undefined,
            exponentialRampToValueAtTime: () => undefined
          },
          connect: () => undefined
        };
      }

      resume() {
        resumeCount += 1;
        this.state = "running";
        return Promise.resolve();
      }
    },
    setTimeout: (() => ({ id: 1 } as ReturnType<typeof setTimeout>)) as typeof setTimeout,
    clearTimeout: (() => undefined) as typeof clearTimeout
  });

  runtime.setScene("explore");
  runtime.playCue("attack");
  assert.deepEqual(runtime.getState(), {
    supported: true,
    assetBacked: false,
    unlocked: false,
    currentScene: "explore",
    lastCue: "attack",
    cueCount: 1,
    musicMode: "pending",
    cueMode: "idle",
    bgmVolume: 100,
    sfxVolume: 100
  });
  assert.equal(audioContextCount, 0);
  assert.equal(starts.length, 0);

  runtime.unlock();
  assert.equal(runtime.getState().unlocked, true);
  assert.equal(runtime.getState().musicMode, "synth");
  assert.equal(runtime.getState().cueMode, "idle");
  assert.equal(audioContextCount, 1);
  assert.ok(starts.length > 0);
  assert.ok(stops.length > 0);
  assert.equal(resumeCount, 1);

  runtime.dispose();
});

test("audio runtime prefers asset-backed playback when a Cocos bridge is available", async () => {
  const loadedPaths: string[] = [];
  const playedMusic: Array<{ path: string; volume: number }> = [];
  const playedCues: Array<{ path: string; volume: number }> = [];
  let stopMusicCount = 0;
  const runtime = createCocosAudioRuntime(cocosPresentationConfig.audio, {
    assetBridge: {
      supported: true,
      loadClip: async (path) => {
        loadedPaths.push(path);
        return { path };
      },
      playMusic: (clip, volume) => {
        playedMusic.push({ path: clip.path, volume });
      },
      stopMusic: () => {
        stopMusicCount += 1;
      },
      playCue: (clip, volume) => {
        playedCues.push({ path: clip.path, volume });
      }
    }
  });

  runtime.setScene("explore");
  assert.equal(runtime.getState().supported, true);
  assert.equal(runtime.getState().assetBacked, true);
  assert.equal(runtime.getState().musicMode, "pending");

  runtime.unlock();
  await flushAsyncAudioTick();
  assert.deepEqual(loadedPaths, ["audio/explore-loop"]);
  assert.deepEqual(playedMusic, [{ path: "audio/explore-loop", volume: 0.54 }]);
  assert.equal(runtime.getState().musicMode, "asset");

  runtime.playCue("skill");
  await flushAsyncAudioTick();
  assert.deepEqual(playedCues, [{ path: "audio/skill", volume: 0.76 }]);
  assert.equal(runtime.getState().cueMode, "asset");

  runtime.dispose();
  assert.ok(stopMusicCount >= 1);
});

test("audio runtime falls back to synth when the asset bridge cannot load a clip", async () => {
  const starts: number[] = [];
  const runtime = createCocosAudioRuntime(cocosPresentationConfig.audio, {
    AudioContext: class {
      currentTime = 0;
      state = "running";
      destination = {};

      createOscillator() {
        return {
          type: "triangle" as OscillatorType,
          frequency: {
            setValueAtTime: () => undefined
          },
          connect: () => undefined,
          start: (time = 0) => {
            starts.push(time);
          },
          stop: () => undefined,
          onended: null
        };
      }

      createGain() {
        return {
          gain: {
            setValueAtTime: () => undefined,
            linearRampToValueAtTime: () => undefined,
            exponentialRampToValueAtTime: () => undefined
          },
          connect: () => undefined
        };
      }
    },
    assetBridge: {
      supported: true,
      loadClip: async () => {
        throw new Error("missing clip");
      },
      playMusic: () => undefined,
      stopMusic: () => undefined,
      playCue: () => undefined
    },
    setTimeout: (() => ({ id: 1 } as ReturnType<typeof setTimeout>)) as typeof setTimeout,
    clearTimeout: (() => undefined) as typeof clearTimeout
  });

  runtime.setScene("battle");
  runtime.unlock();
  await flushAsyncAudioTick();
  assert.equal(runtime.getState().musicMode, "synth");
  assert.ok(starts.length > 0);

  runtime.dispose();
});
