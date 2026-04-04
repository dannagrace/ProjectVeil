import assert from "node:assert/strict";
import test from "node:test";
import { sys } from "cc";
import {
  requestCocosWechatSubscribeConsent,
  resetCocosWechatSubscribeConsentForTests
} from "../assets/scripts/cocos-lobby.ts";

function createStorageRecorder(): {
  values: Map<string, string>;
  storage: Pick<Storage, "setItem">;
} {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      setItem(key: string, value: string) {
        values.set(key, value);
      }
    }
  };
}

test("requestCocosWechatSubscribeConsent requests subscribe messages only once per session", async () => {
  resetCocosWechatSubscribeConsentForTests();
  const originalPlatform = (sys as unknown as { platform?: string }).platform;
  const originalPlatformEnum = (sys as unknown as { Platform?: { WECHAT_GAME?: string } }).Platform;
  (sys as unknown as { platform?: string }).platform = "WECHAT_GAME";
  (sys as unknown as { Platform?: { WECHAT_GAME?: string } }).Platform = { WECHAT_GAME: "WECHAT_GAME" };

  const storageRecorder = createStorageRecorder();
  let requestCalls = 0;
  const environment = {
    process: {
      env: {
        VEIL_WECHAT_MATCH_FOUND_TMPL_ID: "tmpl-match-found",
        VEIL_WECHAT_TURN_REMINDER_TMPL_ID: "tmpl-turn-reminder"
      }
    },
    wx: {
      getLaunchOptionsSync: () => ({ query: {} }),
      requestSubscribeMessage: ({ success }: { success?: (result: Record<string, unknown>) => void }) => {
        requestCalls += 1;
        success?.({
          "tmpl-match-found": "accept",
          "tmpl-turn-reminder": "accept"
        });
      }
    }
  };

  try {
    assert.equal(
      await requestCocosWechatSubscribeConsent({
        storage: storageRecorder.storage,
        environment
      }),
      true
    );
    assert.equal(
      await requestCocosWechatSubscribeConsent({
        storage: storageRecorder.storage,
        environment
      }),
      false
    );
    assert.equal(requestCalls, 1);
    assert.ok(storageRecorder.values.get("project-veil:wechat-subscribe-consent"));
  } finally {
    (sys as unknown as { platform?: string }).platform = originalPlatform;
    (sys as unknown as { Platform?: { WECHAT_GAME?: string } }).Platform = originalPlatformEnum;
    resetCocosWechatSubscribeConsentForTests();
  }
});
