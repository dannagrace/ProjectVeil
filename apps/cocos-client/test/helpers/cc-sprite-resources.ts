import type { TestContext } from "node:test";
import { ImageAsset, SpriteFrame, resources } from "cc";
import { resetPixelSpriteRuntimeForTests } from "../../assets/scripts/cocos-pixel-sprites.ts";
import {
  resetPlaceholderSpriteAssetsForTests,
  setPlaceholderSpriteRuntimeForTests
} from "../../assets/scripts/cocos-placeholder-sprites.ts";

const originalResourcesLoad = resources.load;
const originalSpriteFrameCreateWithImage = SpriteFrame.createWithImage;

function createSpriteFrame(imageAsset: ImageAsset): SpriteFrame {
  const frame = new SpriteFrame();
  frame.name = imageAsset.name;
  frame.texture = imageAsset;
  return frame;
}

export function useCcSpriteResourceDoubles(t: TestContext): void {
  resetPixelSpriteRuntimeForTests();
  resetPlaceholderSpriteAssetsForTests();

  const loader = ((path: string, _type: typeof ImageAsset, callback: (err: Error | null, asset: ImageAsset) => void) => {
    const asset = new ImageAsset();
    asset.name = path;
    callback(null, asset);
  }) as typeof resources.load;

  resources.load = loader;
  SpriteFrame.createWithImage = ((imageAsset: ImageAsset) => createSpriteFrame(imageAsset)) as typeof SpriteFrame.createWithImage;

  setPlaceholderSpriteRuntimeForTests({
    loader: {
      load: (path, _type, callback) => {
        const asset = new ImageAsset();
        asset.name = path;
        callback(null, asset as never);
      },
      release() {}
    },
    spriteFrameFactory: {
      createWithImage: (imageAsset: ImageAsset) => createSpriteFrame(imageAsset)
    }
  });

  t.after(() => {
    resources.load = originalResourcesLoad;
    SpriteFrame.createWithImage = originalSpriteFrameCreateWithImage;
    resetPixelSpriteRuntimeForTests();
    resetPlaceholderSpriteAssetsForTests();
  });
}
