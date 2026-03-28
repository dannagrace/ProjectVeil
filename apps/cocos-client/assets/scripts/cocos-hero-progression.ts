import { createHeroProgressMeterView } from "./project-shared/hero-progression.ts";
import type { SessionUpdate } from "./VeilCocosSession.ts";

export interface HeroProgressNotice {
  title: string;
  detail: string;
}

type HeroProgressedEvent = Extract<SessionUpdate["events"][number], { type: "hero.progressed" }>;

export function buildHeroProgressNotice(
  update: SessionUpdate,
  heroId: string | null
): HeroProgressNotice | null {
  if (!heroId) {
    return null;
  }

  const progressEvent = update.events.find(
    (event) => event.type === "hero.progressed" && event.heroId === heroId
  ) as HeroProgressedEvent | undefined;
  if (!progressEvent || progressEvent.levelsGained <= 0) {
    return null;
  }

  const hero = update.world.ownHeroes.find((item) => item.id === heroId) ?? null;
  const meter = hero ? createHeroProgressMeterView(hero) : null;
  const nextHint = meter
    ? `当前 ${meter.currentLevelExperience}/${meter.nextLevelExperience} XP`
    : `总经验 ${progressEvent.totalExperience}`;
  const skillHint =
    progressEvent.availableSkillPoints > 0
      ? `可立即学习新技能，剩余技能点 ${progressEvent.availableSkillPoints}。`
      : "本次未产生可分配技能点。";

  return {
    title: `升级到 Lv ${progressEvent.level}`,
    detail: `获得 ${progressEvent.experienceGained} XP，${nextHint}。${skillHint}`
  };
}
