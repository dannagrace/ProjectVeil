import type {
  CocosAudioCue,
  CocosMusicScene,
  CocosPresentationConfig,
  CocosPresentationSequence
} from "./cocos-presentation-config.ts";

interface AudioContextLike {
  currentTime: number;
  state?: string;
  destination: unknown;
  createOscillator(): {
    type: OscillatorType;
    frequency: {
      setValueAtTime(value: number, time: number): void;
    };
    connect(node: unknown): void;
    start(time?: number): void;
    stop(time?: number): void;
    onended: (() => void) | null;
  };
  createGain(): {
    gain: {
      setValueAtTime(value: number, time: number): void;
      linearRampToValueAtTime(value: number, time: number): void;
      exponentialRampToValueAtTime(value: number, time: number): void;
    };
    connect(node: unknown): void;
  };
  resume?(): Promise<void>;
  close?(): Promise<void>;
}

interface AudioGlobalsLike {
  AudioContext?: new () => AudioContextLike;
  webkitAudioContext?: new () => AudioContextLike;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

export interface CocosAudioAssetClip {
  path: string;
}

export interface CocosAudioAssetBridge {
  supported: boolean;
  loadClip(path: string): Promise<CocosAudioAssetClip>;
  playMusic(clip: CocosAudioAssetClip, volume: number): void;
  stopMusic(): void;
  playCue(clip: CocosAudioAssetClip, volume: number): void;
}

export type CocosAudioPlaybackMode = "idle" | "pending" | "synth" | "asset";

interface CocosAudioRuntimeDependencies extends AudioGlobalsLike {
  assetBridge?: CocosAudioAssetBridge | null;
  onStateChange?: () => void;
}

export interface CocosAudioRuntimeState {
  supported: boolean;
  assetBacked: boolean;
  unlocked: boolean;
  currentScene: CocosMusicScene | null;
  lastCue: CocosAudioCue | null;
  cueCount: number;
  musicMode: CocosAudioPlaybackMode;
  cueMode: Exclude<CocosAudioPlaybackMode, "pending">;
  bgmVolume: number;
  sfxVolume: number;
}

export interface CocosAudioRuntime {
  unlock(): void;
  setScene(scene: CocosMusicScene | null): void;
  playCue(cue: CocosAudioCue): void;
  setBgmVolume(volume: number): void;
  setSfxVolume(volume: number): void;
  dispose(): void;
  getState(): CocosAudioRuntimeState;
}

export function createCocosAudioRuntime(
  config: CocosPresentationConfig["audio"],
  dependencies: CocosAudioRuntimeDependencies = globalThis as CocosAudioRuntimeDependencies
): CocosAudioRuntime {
  const globals = dependencies;
  const AudioContextCtor = globals.AudioContext ?? globals.webkitAudioContext ?? null;
  const timeout = globals.setTimeout ?? setTimeout;
  const clear = globals.clearTimeout ?? clearTimeout;
  const assetBridge = dependencies.assetBridge?.supported ? dependencies.assetBridge : null;
  const onStateChange = dependencies.onStateChange ?? (() => undefined);

  let audioContext: AudioContextLike | null = null;
  let unlocked = false;
  let currentScene: CocosMusicScene | null = null;
  let activeToken = 0;
  let loopTimer: ReturnType<typeof setTimeout> | null = null;
  let lastCue: CocosAudioCue | null = null;
  let cueCount = 0;
  let musicMode: CocosAudioPlaybackMode = "idle";
  let cueMode: Exclude<CocosAudioPlaybackMode, "pending"> = "idle";
  let bgmVolume = 100;
  let sfxVolume = 100;
  const assetClipCache = new Map<string, Promise<CocosAudioAssetClip | null>>();

  function clampPercent(volume: number): number {
    if (!Number.isFinite(volume)) {
      return 100;
    }

    return Math.min(100, Math.max(0, Math.round(volume)));
  }

  function resolveScaledVolume(baseVolume: number, percent: number): number {
    return baseVolume * (clampPercent(percent) / 100);
  }

  function ensureContext(): AudioContextLike | null {
    if (!AudioContextCtor) {
      return null;
    }
    if (!unlocked) {
      return null;
    }
    if (!audioContext) {
      try {
        audioContext = new AudioContextCtor();
      } catch {
        audioContext = null;
      }
    }

    if (audioContext?.state === "suspended" && audioContext.resume) {
      void audioContext.resume().catch(() => undefined);
    }

    return audioContext;
  }

  function clearLoop(): void {
    if (loopTimer) {
      clear(loopTimer);
      loopTimer = null;
    }
  }

  function supportsAnyPlayback(): boolean {
    return Boolean(AudioContextCtor || assetBridge);
  }

  function notifyStateChange(): void {
    onStateChange();
  }

  function stopMusicPlayback(): void {
    clearLoop();
    assetBridge?.stopMusic();
    musicMode = currentScene ? "pending" : "idle";
    notifyStateChange();
  }

  function playSequence(sequence: CocosPresentationSequence): number {
    const context = ensureContext();
    if (!context) {
      return totalSequenceDurationMs(sequence);
    }

    const now = context.currentTime;
    let cursor = now;
    for (const note of sequence.notes) {
      const oscillator = context.createOscillator();
      const gainNode = context.createGain();
      const noteDurationSeconds = note.durationMs / 1000;
      const attackSeconds = Math.min(sequence.attackMs / 1000, noteDurationSeconds * 0.4);
      const releaseSeconds = Math.min(sequence.releaseMs / 1000, noteDurationSeconds * 0.8);
      const stopAt = cursor + noteDurationSeconds;
      const sustainUntil = Math.max(cursor + attackSeconds, stopAt - releaseSeconds);
      oscillator.type = sequence.waveform;
      oscillator.frequency.setValueAtTime(note.frequency, cursor);
      gainNode.gain.setValueAtTime(0.0001, cursor);
      gainNode.gain.linearRampToValueAtTime(sequence.gain, cursor + attackSeconds);
      gainNode.gain.setValueAtTime(sequence.gain, sustainUntil);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, stopAt);
      oscillator.connect(gainNode);
      gainNode.connect(context.destination);
      oscillator.start(cursor);
      oscillator.stop(stopAt);
      cursor = stopAt + sequence.gapMs / 1000;
    }

    return totalSequenceDurationMs(sequence);
  }

  function totalSequenceDurationMs(sequence: CocosPresentationSequence): number {
    return sequence.notes.reduce((total, note) => total + note.durationMs, 0)
      + Math.max(0, sequence.notes.length - 1) * sequence.gapMs
      + sequence.loopGapMs;
  }

  function scheduleSceneLoop(scene: CocosMusicScene, token: number): void {
    const durationMs = playSequence(config.music[scene]);
    musicMode = "synth";
    notifyStateChange();
    clearLoop();
    loopTimer = timeout(() => {
      if (token !== activeToken || currentScene !== scene) {
        return;
      }
      scheduleSceneLoop(scene, token);
    }, durationMs);
  }

  function loadAssetClip(assetPath: string): Promise<CocosAudioAssetClip | null> {
    if (!assetBridge || !assetPath) {
      return Promise.resolve(null);
    }

    const cached = assetClipCache.get(assetPath);
    if (cached) {
      return cached;
    }

    const promise = assetBridge.loadClip(assetPath).catch(() => null);
    assetClipCache.set(assetPath, promise);
    return promise;
  }

  async function playSceneWithBestPath(scene: CocosMusicScene, token: number): Promise<void> {
    const sequence = config.music[scene];
    if (assetBridge && unlocked && sequence.assetPath) {
      musicMode = "pending";
      notifyStateChange();
      const clip = await loadAssetClip(sequence.assetPath);
      if (token !== activeToken || currentScene !== scene) {
        return;
      }
      if (clip) {
        clearLoop();
        assetBridge.stopMusic();
        assetBridge.playMusic(clip, resolveScaledVolume(sequence.assetVolume, bgmVolume));
        musicMode = "asset";
        notifyStateChange();
        return;
      }
    }

    if (token !== activeToken || currentScene !== scene) {
      return;
    }

    scheduleSceneLoop(scene, token);
  }

  return {
    unlock() {
      if (!supportsAnyPlayback()) {
        return;
      }

      const wasUnlocked = unlocked;
      unlocked = true;
      notifyStateChange();
      const context = ensureContext();
      if (!wasUnlocked && currentScene && !loopTimer) {
        activeToken += 1;
        void playSceneWithBestPath(currentScene, activeToken);
        return;
      }

      if (context?.state === "suspended" && context.resume) {
        void context.resume().catch(() => undefined);
      }
    },
    setScene(scene) {
      if (scene === currentScene) {
        return;
      }

      currentScene = scene;
      activeToken += 1;
      stopMusicPlayback();

      if (!scene) {
        return;
      }

      if (!unlocked && supportsAnyPlayback()) {
        return;
      }

      void playSceneWithBestPath(scene, activeToken);
    },
    playCue(cue) {
      lastCue = cue;
      cueCount += 1;
      notifyStateChange();
      const sequence = config.cues[cue];
      if (assetBridge && unlocked && sequence.assetPath) {
        void loadAssetClip(sequence.assetPath).then((clip) => {
          if (clip) {
            assetBridge.playCue(clip, resolveScaledVolume(sequence.assetVolume, sfxVolume));
            cueMode = "asset";
            notifyStateChange();
            return;
          }
          cueMode = "synth";
          notifyStateChange();
          playSequence(sequence);
        });
        return;
      }

      cueMode = unlocked && AudioContextCtor ? "synth" : "idle";
      notifyStateChange();
      playSequence(sequence);
    },
    setBgmVolume(volume) {
      const nextVolume = clampPercent(volume);
      if (nextVolume === bgmVolume) {
        return;
      }

      bgmVolume = nextVolume;
      if (currentScene) {
        activeToken += 1;
        stopMusicPlayback();
        if (unlocked || !supportsAnyPlayback()) {
          void playSceneWithBestPath(currentScene, activeToken);
        }
      }
      notifyStateChange();
    },
    setSfxVolume(volume) {
      const nextVolume = clampPercent(volume);
      if (nextVolume === sfxVolume) {
        return;
      }

      sfxVolume = nextVolume;
      notifyStateChange();
    },
    dispose() {
      stopMusicPlayback();
      currentScene = null;
      activeToken += 1;
      musicMode = "idle";
      cueMode = "idle";
      notifyStateChange();
      if (audioContext?.close) {
        void audioContext.close().catch(() => undefined);
      }
      audioContext = null;
    },
    getState() {
      return {
        supported: supportsAnyPlayback(),
        assetBacked: Boolean(assetBridge),
        unlocked,
        currentScene,
        lastCue,
        cueCount,
        musicMode,
        cueMode,
        bgmVolume,
        sfxVolume
      };
    }
  };
}
