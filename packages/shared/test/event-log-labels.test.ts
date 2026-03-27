import assert from "node:assert/strict";
import test from "node:test";
import { formatAchievementLabel, formatWorldEventTypeLabel, getAchievementDefinition } from "../src/index";

test("event log label helpers resolve shared achievement and world event labels", () => {
  assert.equal(getAchievementDefinition("first_battle")?.title, "初次交锋");
  assert.equal(formatAchievementLabel("enemy_slayer"), "猎敌者");
  assert.equal(formatWorldEventTypeLabel("battle.started"), "战斗触发");
  assert.equal(formatWorldEventTypeLabel("hero.skillLearned"), "技能学习");
});
