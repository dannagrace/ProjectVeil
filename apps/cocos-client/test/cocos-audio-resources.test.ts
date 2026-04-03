import assert from "node:assert/strict";
import test from "node:test";
import { AudioClip, AudioSource, Node, resources } from "cc";
import { createCocosAudioAssetBridge } from "../assets/scripts/cocos-audio-resources";

function getAudioSource(hostNode: Node, name: string): AudioSource {
  const node = hostNode.getChildByName(name);
  assert.ok(node, `expected audio node ${name}`);
  const source = node.getComponent(AudioSource);
  assert.ok(source, `expected AudioSource on ${name}`);
  return source;
}

test("audio asset bridge reuses existing music source and creates a cue source", () => {
  const hostNode = new Node("Host");
  const existingMusicNode = new Node("ProjectVeilMusicAudio");
  existingMusicNode.parent = hostNode;
  const existingMusicSource = existingMusicNode.addComponent(AudioSource);
  existingMusicSource.loop = false;

  createCocosAudioAssetBridge(hostNode);

  assert.equal(hostNode.children.length, 2);
  assert.equal(getAudioSource(hostNode, "ProjectVeilMusicAudio"), existingMusicSource);
  assert.equal(existingMusicSource.loop, true);

  const cueSource = getAudioSource(hostNode, "ProjectVeilCueAudio");
  assert.equal(cueSource.loop, false);
});

test("audio asset bridge caches loaded clips by asset path", async () => {
  const hostNode = new Node("Host");
  const bridge = createCocosAudioAssetBridge(hostNode);
  const originalLoad = resources.load;
  const loadedPaths: string[] = [];

  resources.load = ((path, Type, callback) => {
    loadedPaths.push(path);
    callback(null, new Type());
  }) as typeof resources.load;

  try {
    const first = bridge.loadClip("audio/explore-loop");
    const second = bridge.loadClip("audio/explore-loop");
    const third = await bridge.loadClip("audio/click");

    assert.equal(first, second);
    assert.deepEqual(loadedPaths, ["audio/explore-loop", "audio/click"]);
    assert.equal((await first).path, "audio/explore-loop");
    assert.ok((await first).clip instanceof AudioClip);
    assert.equal(third.path, "audio/click");
  } finally {
    resources.load = originalLoad;
  }
});

test("audio asset bridge surfaces resource load failures", async () => {
  const hostNode = new Node("Host");
  const bridge = createCocosAudioAssetBridge(hostNode);
  const originalLoad = resources.load;

  try {
    resources.load = ((_path, _Type, callback) => {
      callback(new Error("asset missing"), null);
    }) as typeof resources.load;

    await assert.rejects(bridge.loadClip("audio/missing"), /asset missing/);

    resources.load = ((_path, _Type, callback) => {
      callback(null, null);
    }) as typeof resources.load;

    await assert.rejects(bridge.loadClip("audio/empty"), /Failed to load audio clip: audio\/empty/);
  } finally {
    resources.load = originalLoad;
  }
});

test("audio asset bridge routes music and cue playback through dedicated sources with clamped volume", () => {
  const hostNode = new Node("Host");
  const bridge = createCocosAudioAssetBridge(hostNode);
  const musicSource = getAudioSource(hostNode, "ProjectVeilMusicAudio");
  const cueSource = getAudioSource(hostNode, "ProjectVeilCueAudio");
  const managedClip = {
    path: "audio/battle-loop",
    clip: new AudioClip()
  };

  let musicStopCount = 0;
  let musicPlayCount = 0;
  let cuePlayOneShot: { clip: AudioClip | null; volume: number } | null = null;

  musicSource.stop = () => {
    musicStopCount += 1;
  };
  musicSource.play = () => {
    musicPlayCount += 1;
  };
  cueSource.playOneShot = (clip, volume) => {
    cuePlayOneShot = { clip, volume };
  };

  bridge.playMusic(managedClip, Number.NaN);
  assert.equal(musicStopCount, 1);
  assert.equal(musicPlayCount, 1);
  assert.equal(musicSource.clip, managedClip.clip);
  assert.equal(musicSource.loop, true);
  assert.equal(musicSource.volume, 0.72);

  bridge.playMusic(managedClip, 4);
  assert.equal(musicSource.volume, 1);

  bridge.playMusic(managedClip, -10);
  assert.equal(musicSource.volume, 0.01);

  cueSource.volume = 0.2;
  bridge.playCue(managedClip, 0);
  assert.equal(cueSource.volume, 1);
  assert.deepEqual(cuePlayOneShot, {
    clip: managedClip.clip,
    volume: 0.01
  });

  bridge.stopMusic();
  assert.equal(musicStopCount, 4);
});
