import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const cocosResourcesDir = path.join(rootDir, "apps/cocos-client/assets/resources");
const presentationConfig = JSON.parse(
  readFileSync(path.join(rootDir, "configs/cocos-presentation.json"), "utf8")
);

const sampleRate = 22050;
const musicTargets = Object.values(presentationConfig.audio?.music ?? {});
const cueTargets = Object.values(presentationConfig.audio?.cues ?? {});
const allTargets = [...musicTargets, ...cueTargets]
  .filter((sequence) => typeof sequence?.assetPath === "string" && sequence.assetPath.length > 0);

let writtenCount = 0;
for (const sequence of allTargets) {
  const filepath = path.join(cocosResourcesDir, `${sequence.assetPath}.wav`);
  mkdirSync(path.dirname(filepath), { recursive: true });
  writeFileSync(filepath, createWaveBuffer(sequence, sampleRate));
  writtenCount += 1;
}

console.log(`Synced ${writtenCount} Cocos placeholder audio assets into resources/audio.`);

function createWaveBuffer(sequence, rate) {
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = channels * bitsPerSample / 8;
  const byteRate = rate * blockAlign;
  const samples = renderSequence(sequence, rate);
  const dataSize = samples.length * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < samples.length; index += 1) {
    buffer.writeInt16LE(samples[index], 44 + index * 2);
  }

  return buffer;
}

function renderSequence(sequence, rate) {
  const gain = clamp(sequence.gain ?? 0.08, 0.01, 0.9);
  const noteEntries = Array.isArray(sequence.notes) && sequence.notes.length > 0
    ? sequence.notes
    : [{ frequency: 220, durationMs: 160 }];
  const samples = [];

  for (const note of noteEntries) {
    const durationMs = Math.max(20, Number(note.durationMs) || 120);
    const frequency = Math.max(60, Number(note.frequency) || 220);
    const noteSampleCount = Math.max(1, Math.round(durationMs * rate / 1000));
    const attackCount = Math.max(1, Math.min(noteSampleCount, Math.round((sequence.attackMs ?? 12) * rate / 1000)));
    const releaseCount = Math.max(1, Math.min(noteSampleCount, Math.round((sequence.releaseMs ?? 96) * rate / 1000)));

    for (let sampleIndex = 0; sampleIndex < noteSampleCount; sampleIndex += 1) {
      const time = sampleIndex / rate;
      const phase = (time * frequency) % 1;
      const base = sampleWave(sequence.waveform, phase);
      const envelope = envelopeGain(sampleIndex, noteSampleCount, attackCount, releaseCount);
      const shimmer = 0.9 + Math.sin(time * Math.PI * 2 * (frequency / 12)) * 0.06;
      const sample = clamp(base * envelope * shimmer * gain, -1, 1);
      samples.push(Math.round(sample * 32767));
    }

    const gapSamples = Math.max(0, Math.round((sequence.gapMs ?? 0) * rate / 1000));
    for (let gapIndex = 0; gapIndex < gapSamples; gapIndex += 1) {
      samples.push(0);
    }
  }

  const loopGapSamples = Math.max(0, Math.round((sequence.loopGapMs ?? 0) * rate / 1000));
  for (let gapIndex = 0; gapIndex < loopGapSamples; gapIndex += 1) {
    samples.push(0);
  }

  return Int16Array.from(samples);
}

function sampleWave(waveform, phase) {
  switch (waveform) {
    case "square":
      return phase < 0.5 ? 1 : -1;
    case "sawtooth":
      return phase * 2 - 1;
    case "triangle":
      return 1 - 4 * Math.abs(phase - 0.5);
    default:
      return Math.sin(phase * Math.PI * 2);
  }
}

function envelopeGain(sampleIndex, noteSampleCount, attackCount, releaseCount) {
  if (sampleIndex < attackCount) {
    return sampleIndex / attackCount;
  }

  const releaseStart = noteSampleCount - releaseCount;
  if (sampleIndex >= releaseStart) {
    return Math.max(0.0001, (noteSampleCount - sampleIndex) / releaseCount);
  }

  return 1;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
