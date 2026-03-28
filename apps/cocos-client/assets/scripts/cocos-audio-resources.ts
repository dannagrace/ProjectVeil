import { AudioClip, AudioSource, Node, resources } from "cc";
import type { CocosAudioAssetBridge, CocosAudioAssetClip } from "./cocos-audio-runtime.ts";

const MUSIC_NODE_NAME = "ProjectVeilMusicAudio";
const CUE_NODE_NAME = "ProjectVeilCueAudio";

interface CocosManagedAudioClip extends CocosAudioAssetClip {
  clip: AudioClip;
}

export function createCocosAudioAssetBridge(hostNode: Node): CocosAudioAssetBridge {
  const clipCache = new Map<string, Promise<CocosManagedAudioClip>>();
  const musicSource = ensureAudioSource(hostNode, MUSIC_NODE_NAME, true);
  const cueSource = ensureAudioSource(hostNode, CUE_NODE_NAME, false);

  return {
    supported: true,
    loadClip(path) {
      const cached = clipCache.get(path);
      if (cached) {
        return cached;
      }

      const promise = new Promise<CocosManagedAudioClip>((resolve, reject) => {
        resources.load(path, AudioClip, (err, clip) => {
          if (err || !clip) {
            reject(err ?? new Error(`Failed to load audio clip: ${path}`));
            return;
          }

          resolve({
            path,
            clip
          });
        });
      });

      clipCache.set(path, promise);
      return promise;
    },
    playMusic(clip, volume) {
      const managed = clip as CocosManagedAudioClip;
      musicSource.stop();
      musicSource.clip = managed.clip;
      musicSource.loop = true;
      musicSource.volume = clampVolume(volume);
      musicSource.play();
    },
    stopMusic() {
      musicSource.stop();
    },
    playCue(clip, volume) {
      const managed = clip as CocosManagedAudioClip;
      cueSource.volume = 1;
      cueSource.playOneShot(managed.clip, clampVolume(volume));
    }
  };
}

function ensureAudioSource(hostNode: Node, nodeName: string, loop: boolean): AudioSource {
  let node = hostNode.getChildByName(nodeName);
  if (!node) {
    node = new Node(nodeName);
    node.parent = hostNode;
  }

  const source = node.getComponent(AudioSource) ?? node.addComponent(AudioSource);
  source.loop = loop;
  return source;
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.72;
  }
  return Math.min(1, Math.max(0.01, value));
}
