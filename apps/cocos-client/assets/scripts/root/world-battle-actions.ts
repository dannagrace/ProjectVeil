// @ts-nocheck

import {
  buildCocosProfileNotice,
  buildHeroProgressNotice,
  createPrimaryClientTelemetryEvent,
  describeMoveAttemptFeedback,
  formatEquipmentActionReason,
  formatEquipmentSlotLabel,
  formatHeroStatBonus,
  formatResourceKindLabel,
  formatUpgradeCostLabel,
  getBuildingUpgradeConfig,
  getEquipmentDefinition,
  predictPlayerWorldAction,
  predictSharedPlayerWorldAction,
  type EquipmentType,
  type HeroView,
  type PlayerTileView,
  type Vec2,
  type VeilHudRenderState,
  type CocosBattleFeedbackView
} from "./deps.ts";
import { BATTLE_FEEDBACK_DURATION_MS } from "./constants";

class VeilRootWorldBattleActionsMethods {
  [key: string]: any;
  async advanceDay(): Promise<void> {
    if (this.moveInFlight || this.battleActionInFlight) {
      return;
    }

    if (!this.session) {
      await this.connect();
      return;
    }

    if (this.lastUpdate?.battle) {
      this.pushLog("战斗中无法推进天数。");
      this.predictionStatus = "战斗中无法推进天数。";
      this.renderView();
      return;
    }

    this.predictionStatus = "正在推进到下一天...";
    this.moveInFlight = true;
    this.renderView();

    try {
      await this.applySessionUpdate(await this.session.endDay());
      this.pushLog("已推进到下一天。");
    } catch (error) {
      this.maybeReportSessionRuntimeError(error, "end_day");
      const failureMessage = this.describeSessionError(error, "推进天数失败。");
      if (error instanceof Error && error.message === "upgrade_required") {
        await this.handleForcedUpgrade(failureMessage);
        return;
      }
      this.pushLog(failureMessage);
      this.predictionStatus = failureMessage;
    } finally {
      this.moveInFlight = false;
    }

    this.renderView();
  }

  async learnHeroSkill(skillId: string): Promise<void> {
    if (this.moveInFlight || this.battleActionInFlight) {
      return;
    }

    if (!this.session) {
      await this.connect();
      return;
    }

    const hero = this.activeHero();
    if (!hero) {
      this.pushLog("当前快照里没有可控制的英雄。");
      this.renderView();
      return;
    }

    if (this.lastUpdate?.battle) {
      this.pushLog("战斗中无法调整技能树。");
      this.predictionStatus = "战斗中无法调整技能树。";
      this.renderView();
      return;
    }

    this.moveInFlight = true;
    this.predictionStatus = `正在学习技能 ${skillId}...`;
    this.pushLog(`正在为 ${hero.name} 学习技能 ${skillId}...`);
    this.renderView();

    try {
      const update = await this.session.learnSkill(hero.id, skillId);
      await this.applySessionUpdate(update);
      this.pushSessionActionOutcome(update, {
        successMessage: "技能学习已结算。",
        rejectedLabel: "技能学习"
      });
    } catch (error) {
      const failureMessage = this.describeSessionError(error, "技能学习失败。");
      if (error instanceof Error && error.message === "upgrade_required") {
        await this.handleForcedUpgrade(failureMessage);
        return;
      }
      this.pushLog(failureMessage);
      this.predictionStatus = failureMessage;
    } finally {
      this.moveInFlight = false;
    }

    this.renderView();
  }

  async equipHeroItem(slot: EquipmentType, equipmentId: string): Promise<void> {
    if (this.moveInFlight || this.battleActionInFlight) {
      return;
    }

    if (!this.session) {
      await this.connect();
      return;
    }

    const hero = this.activeHero();
    if (!hero) {
      this.pushLog("当前快照里没有可控制的英雄。");
      this.emitPrimaryClientTelemetry(
        createPrimaryClientTelemetryEvent(this.createTelemetryContext(), {
          category: "inventory",
          checkpoint: "equipment.equip.rejected",
          status: "blocked",
          detail: "Equip request ignored because no controlled hero is present.",
          reason: "no_controlled_hero"
        })
      );
      this.renderView();
      return;
    }

    if (this.lastUpdate?.battle) {
      this.pushLog("战斗中无法调整装备。");
      this.predictionStatus = "战斗中无法调整装备。";
      this.emitPrimaryClientTelemetry(
        createPrimaryClientTelemetryEvent(this.createTelemetryContext(hero.id), {
          category: "inventory",
          checkpoint: "equipment.equip.rejected",
          status: "blocked",
          detail: "Equip request rejected because the client is currently in battle.",
          reason: "in_battle"
        })
      );
      this.renderView();
      return;
    }

    const itemName = getEquipmentDefinition(equipmentId)?.name ?? equipmentId;
    this.moveInFlight = true;
    this.predictionStatus = `正在装备 ${itemName}...`;
    this.pushLog(`正在为 ${hero.name} 装备 ${itemName}...`);
    this.applyPrediction(
      {
        type: "hero.equip",
        heroId: hero.id,
        slot,
        equipmentId
      },
      `预演装备 ${itemName}`
    );
    this.renderView();

    try {
      const update = await this.session.equipHeroItem(hero.id, slot, equipmentId);
      await this.applySessionUpdate(update);
      this.pushSessionActionOutcome(update, {
        successMessage: "装备已结算。",
        rejectedLabel: "装备调整"
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "equip_failed";
      const detail = error instanceof Error ? formatEquipmentActionReason(error.message) : "装备失败。";
      this.emitPrimaryClientTelemetry(
        createPrimaryClientTelemetryEvent(this.createTelemetryContext(hero.id), {
          category: "inventory",
          checkpoint: "equipment.equip.rejected",
          status: "failure",
          detail,
          reason,
          slot,
          ...(equipmentId ? { equipmentId } : {})
        })
      );
      this.rollbackPrediction(error instanceof Error ? formatEquipmentActionReason(error.message) : "装备失败。");
    } finally {
      this.moveInFlight = false;
    }

    this.renderView();
  }

  async unequipHeroItem(slot: EquipmentType): Promise<void> {
    if (this.moveInFlight || this.battleActionInFlight) {
      return;
    }

    if (!this.session) {
      await this.connect();
      return;
    }

    const hero = this.activeHero();
    if (!hero) {
      this.pushLog("当前快照里没有可控制的英雄。");
      this.emitPrimaryClientTelemetry(
        createPrimaryClientTelemetryEvent(this.createTelemetryContext(), {
          category: "inventory",
          checkpoint: "equipment.unequip.rejected",
          status: "blocked",
          detail: "Unequip request ignored because no controlled hero is present.",
          reason: "no_controlled_hero"
        })
      );
      this.renderView();
      return;
    }

    if (this.lastUpdate?.battle) {
      this.pushLog("战斗中无法调整装备。");
      this.predictionStatus = "战斗中无法调整装备。";
      this.emitPrimaryClientTelemetry(
        createPrimaryClientTelemetryEvent(this.createTelemetryContext(hero.id), {
          category: "inventory",
          checkpoint: "equipment.unequip.rejected",
          status: "blocked",
          detail: "Unequip request rejected because the client is currently in battle.",
          reason: "in_battle"
        })
      );
      this.renderView();
      return;
    }

    const currentItemId =
      slot === "weapon"
        ? hero.loadout.equipment.weaponId
        : slot === "armor"
          ? hero.loadout.equipment.armorId
          : hero.loadout.equipment.accessoryId;
    const itemName = currentItemId ? getEquipmentDefinition(currentItemId)?.name ?? currentItemId : formatEquipmentSlotLabel(slot);
    this.moveInFlight = true;
    this.predictionStatus = `正在卸下 ${itemName}...`;
    this.pushLog(`正在为 ${hero.name} 卸下 ${itemName}...`);
    this.applyPrediction(
      {
        type: "hero.unequip",
        heroId: hero.id,
        slot
      },
      `预演卸下 ${itemName}`
    );
    this.renderView();

    try {
      const update = await this.session.unequipHeroItem(hero.id, slot);
      await this.applySessionUpdate(update);
      this.pushSessionActionOutcome(update, {
        successMessage: "卸装已结算。",
        rejectedLabel: "卸装"
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unequip_failed";
      const detail = error instanceof Error ? formatEquipmentActionReason(error.message) : "卸装失败。";
      this.emitPrimaryClientTelemetry(
        createPrimaryClientTelemetryEvent(this.createTelemetryContext(hero.id), {
          category: "inventory",
          checkpoint: "equipment.unequip.rejected",
          status: "failure",
          detail,
          reason,
          slot,
          ...(currentItemId ? { equipmentId: currentItemId } : {})
        })
      );
      this.rollbackPrediction(error instanceof Error ? formatEquipmentActionReason(error.message) : "卸装失败。");
    } finally {
      this.moveInFlight = false;
    }

    this.renderView();
  }

  setBattleFeedback(feedback: CocosBattleFeedbackView | null, durationMs = BATTLE_FEEDBACK_DURATION_MS): void {
    if (!feedback) {
      return;
    }

    this.battleFeedback = {
      ...feedback,
      expiresAt: Date.now() + durationMs
    };
  }

  activeHero(): HeroView | null {
    return this.lastUpdate?.world.ownHeroes[0] ?? null;
  }

  controlledBattleCamp(): "attacker" | "defender" | null {
    const battle = this.lastUpdate?.battle;
    const heroId = this.activeHero()?.id;
    if (!battle || !heroId) {
      return null;
    }

    if (battle.worldHeroId === heroId) {
      return "attacker";
    }

    if (battle.defenderHeroId === heroId) {
      return "defender";
    }

    return null;
  }

  opposingBattleCamp(camp: "attacker" | "defender" | null): "attacker" | "defender" | null {
    if (!camp) {
      return null;
    }

    return camp === "attacker" ? "defender" : "attacker";
  }

  syncSelectedBattleTarget(): void {
    const battle = this.lastUpdate?.battle;
    const enemyCamp = this.opposingBattleCamp(this.controlledBattleCamp());
    if (!battle || !enemyCamp) {
      this.selectedBattleTargetId = null;
      return;
    }

    const targets = Object.values(battle.units).filter((unit) => unit.camp === enemyCamp && unit.count > 0);
    if (targets.length === 0) {
      this.selectedBattleTargetId = null;
      return;
    }

    if (!this.selectedBattleTargetId || !targets.some((target) => target.id === this.selectedBattleTargetId)) {
      this.selectedBattleTargetId = targets[0]?.id ?? null;
    }
  }

  selectedInteractionTile(): PlayerTileView | null {
    const buildingId = this.selectedInteractionBuildingId;
    if (!buildingId) {
      return null;
    }

    return this.lastUpdate?.world.map.tiles.find((tile) => tile.building?.id === buildingId) ?? null;
  }

  clearSelectedInteractionBuilding(): void {
    this.selectedInteractionBuildingId = null;
  }

  buildHudInteractionState(): VeilHudRenderState["interaction"] {
    const hero = this.activeHero();
    const tile = this.selectedInteractionTile();
    const building = tile?.building;
    if (!hero || !tile || !building) {
      return null;
    }

    const heroDistance = Math.abs(hero.position.x - tile.position.x) + Math.abs(hero.position.y - tile.position.y);
    if (heroDistance > 1) {
      return null;
    }

    const actions: NonNullable<VeilHudRenderState["interaction"]>["actions"] = [];
    const tierLabel = `等级 ${building.tier}${building.maxTier ? `/${building.maxTier}` : ""}`;
    const trackId = building.kind === "recruitment_post" ? "castle" : building.kind === "resource_mine" ? "mine" : null;
    const maxTier = building.maxTier ?? (trackId === "castle" ? 3 : trackId === "mine" ? 2 : building.tier);
    const upgradeStep =
      building.kind === "recruitment_post" || building.kind === "resource_mine"
        ? getBuildingUpgradeConfig()[trackId!].find((step) => step.fromTier === building.tier) ?? null
        : null;

    if (heroDistance === 0) {
      if (building.kind === "recruitment_post") {
        actions.push({ id: "recruit", label: "招募部队" });
      } else if (building.kind === "attribute_shrine" || building.kind === "watchtower") {
        actions.push({ id: "visit", label: "访问建筑" });
      } else if (building.kind === "resource_mine") {
        actions.push({ id: "claim", label: "采集矿场" });
      }
    }

    if ((building.kind === "recruitment_post" || building.kind === "resource_mine") && building.ownerPlayerId === hero.playerId) {
      if (building.tier >= maxTier) {
        return {
          title: building.label,
          detail: `${tierLabel} · 已满级`,
          actions
        };
      }

      if (upgradeStep) {
        actions.push({ id: "upgrade", label: `升级建筑 · ${building.tier}→${upgradeStep.toTier}` });
        return {
          title: building.label,
          detail: `${tierLabel} · 升级花费 ${formatUpgradeCostLabel(upgradeStep.cost)}`,
          actions
        };
      }
    }

    return {
      title: building.label,
      detail:
        building.kind === "resource_mine"
          ? `${tierLabel} · ${formatResourceKindLabel(building.resourceKind)} +${building.income}`
          : building.kind === "recruitment_post"
            ? `${tierLabel} · 可招募 ${building.availableCount} 单位`
            : tierLabel,
      actions
    };
  }

  async executeBuildingInteraction(tile: PlayerTileView, actionId: "recruit" | "visit" | "claim" | "upgrade"): Promise<void> {
    const hero = this.activeHero();
    const building = tile.building;
    if (!hero || !building || !this.session) {
      return;
    }

    this.moveInFlight = true;
    const predictionAction =
      actionId === "recruit"
        ? { type: "hero.recruit", heroId: hero.id, buildingId: building.id } as const
        : actionId === "visit"
          ? { type: "hero.visit", heroId: hero.id, buildingId: building.id } as const
          : actionId === "claim"
            ? { type: "hero.claimMine", heroId: hero.id, buildingId: building.id } as const
            : { type: "hero.upgradeBuilding", heroId: hero.id, buildingId: building.id } as const;
    const predictionLabel =
      actionId === "recruit"
        ? `预演招募 ${building.kind === "recruitment_post" ? building.availableCount : 0} 单位`
        : actionId === "visit"
          ? building.kind === "attribute_shrine"
            ? `预演获得 ${formatHeroStatBonus(building.bonus)}`
            : building.kind === "watchtower"
              ? `预演提高视野 ${building.visionBonus}`
              : "预演访问建筑"
          : actionId === "claim"
            ? building.kind === "resource_mine"
              ? `预演占领矿场，改为每日产出 ${building.income} ${formatResourceKindLabel(building.resourceKind)}`
              : "预演矿场采集"
            : "预演建筑升级";
    this.applyPrediction(predictionAction, predictionLabel);
    this.renderView();

    try {
      this.mapBoard?.playHeroAnimation("attack");
      const update =
        actionId === "recruit"
          ? await this.session.recruit(hero.id, building.id)
          : actionId === "visit"
            ? await this.session.visitBuilding(hero.id, building.id)
            : actionId === "claim"
              ? await this.session.claimMine(hero.id, building.id)
              : await this.session.upgradeBuilding(hero.id, building.id);
      this.clearSelectedInteractionBuilding();
      await this.applySessionUpdate(update);
      this.pushSessionActionOutcome(update, {
        successMessage:
          actionId === "recruit"
            ? "招募已结算。"
            : actionId === "visit"
              ? building.kind === "watchtower"
                ? "瞭望塔访问已结算。"
                : "建筑访问已结算。"
              : actionId === "claim"
                ? "矿场占领已结算。"
                : "建筑升级已结算。",
        rejectedLabel:
          actionId === "recruit"
            ? "招募"
            : actionId === "visit"
              ? "访问"
              : actionId === "claim"
                ? "矿场占领"
                : "建筑升级"
      });
    } catch (error) {
      this.rollbackPrediction(error instanceof Error ? error.message : `${actionId}失败。`);
    } finally {
      this.moveInFlight = false;
      this.renderView();
    }
  }

  async moveHeroToTile(tile: PlayerTileView): Promise<void> {
    if (this.moveInFlight) {
      return;
    }

    if (!this.session) {
      await this.connect();
      return;
    }

    const hero = this.activeHero();
    if (!hero) {
      this.pushLog("当前快照里没有可控制的英雄。");
      this.renderView();
      return;
    }

    if (this.lastUpdate?.battle) {
      this.pushLog("当前正在战斗，暂时无法移动。");
      this.renderView();
      return;
    }

    const reachableTiles = await this.ensureReachableTiles(hero.id);
    const clickedCurrentTile = hero.position.x === tile.position.x && hero.position.y === tile.position.y;
    if (!clickedCurrentTile && tile.building) {
      const interactionDistance = Math.abs(hero.position.x - tile.position.x) + Math.abs(hero.position.y - tile.position.y);
      if (interactionDistance <= 1) {
        this.selectedInteractionBuildingId = tile.building.id;
        this.pushLog(`已选中 ${tile.building.label}，请在 HUD 中确认操作。`);
        this.mapBoard?.pulseObject(tile.position, 1.2, 0.24);
        this.renderView();
        return;
      }
    }

    if (clickedCurrentTile) {
      if (!tile.resource && !tile.building) {
        this.pushLog("英雄已经站在这里了。");
        this.mapBoard?.pulseTile(tile.position, 1.04, 0.14);
        this.mapBoard?.showTileFeedback(tile.position, "原地", 0.45);
        this.renderView();
        return;
      }

      if (tile.building) {
        this.selectedInteractionBuildingId = tile.building.id;
        this.pushLog(`已选中 ${tile.building.label}，请在 HUD 中确认操作。`);
        this.mapBoard?.pulseObject(tile.position, 1.2, 0.24);
        this.renderView();
        return;
      }

      const resource = tile.resource;
      if (!resource) {
        this.clearSelectedInteractionBuilding();
        this.pushLog("当前格子没有可采集资源。");
        this.renderView();
        return;
      }

      this.moveInFlight = true;
      const resourceLabel = resource.kind === "gold" ? "金币" : resource.kind === "wood" ? "木材" : resource.kind === "ore" ? "矿石" : resource.kind;
      this.pushLog(`正在采集 ${resourceLabel} +${resource.amount}`);
      this.mapBoard?.pulseTile(tile.position, 1.12, 0.22);
      this.mapBoard?.pulseObject(tile.position, 1.2, 0.24);
      this.applyPrediction(
        {
          type: "hero.collect",
          heroId: hero.id,
          position: tile.position
        },
        `预演采集 ${resourceLabel} +${resource.amount}`
      );
      this.renderView();

      try {
        this.mapBoard?.playHeroAnimation("attack");
        const update = await this.session.collect(hero.id, tile.position);
        await this.applySessionUpdate(update);
        this.pushSessionActionOutcome(update, {
          successMessage: "采集已结算。",
          rejectedLabel: "采集"
        });
      } catch (error) {
        this.rollbackPrediction(error instanceof Error ? error.message : "采集失败。");
      } finally {
        this.moveInFlight = false;
        this.renderView();
      }
      return;
    }

    this.clearSelectedInteractionBuilding();
    if (hero.move.remaining <= 0) {
      this.pushLog(`${hero.name} 今天已经没有移动力了。`);
      this.predictionStatus = "今天已经没有移动点了。";
      this.mapBoard?.pulseTile(hero.position, 1.06, 0.18);
      this.mapBoard?.showTileFeedback(hero.position, "耗尽", 0.7);
      this.renderView();
      return;
    }

    const target = reachableTiles.find((node) => node.x === tile.position.x && node.y === tile.position.y) ?? null;
    if (!target) {
      const movePrediction = this.lastUpdate
        ? predictSharedPlayerWorldAction(this.lastUpdate.world, {
            type: "hero.move",
            heroId: hero.id,
            destination: tile.position
          })
        : null;
      const moveFeedback = describeMoveAttemptFeedback(tile.position, movePrediction?.reason);
      this.pushLog(moveFeedback.message);
      if (movePrediction?.reason === "not_enough_move_points") {
        this.predictionStatus = moveFeedback.message;
      }
      this.mapBoard?.pulseTile(tile.position, 1.08, 0.18);
      this.mapBoard?.showTileFeedback(tile.position, moveFeedback.tileFeedback, 0.6);
      this.renderView();
      return;
    }

    this.moveInFlight = true;
    this.pushLog(`正在移动 ${hero.name} -> (${target.x}, ${target.y})`);
    this.mapBoard?.pulseTile(target, tile.occupant?.kind ? 1.1 : 1.06, 0.18);
    if (tile.resource || tile.occupant) {
      this.mapBoard?.pulseObject(target, tile.occupant?.kind ? 1.18 : 1.14, 0.22);
    }
    this.applyPrediction(
      {
        type: "hero.move",
        heroId: hero.id,
        destination: target
      },
      tile.occupant?.kind === "neutral" || tile.occupant?.kind === "hero"
        ? "正在预演遭遇..."
        : "正在预演移动..."
    );
    this.renderView();

    try {
      this.mapBoard?.playHeroAnimation("move");
      const update = await this.session.moveHero(hero.id, target);
      await this.applySessionUpdate(update);
      this.pushSessionActionOutcome(update, {
        successMessage: "移动已结算。",
        rejectedLabel: "移动"
      });
    } catch (error) {
      this.rollbackPrediction(error instanceof Error ? error.message : "移动失败。");
    } finally {
      this.moveInFlight = false;
      this.renderView();
    }
  }

  async ensureReachableTiles(heroId: string): Promise<Vec2[]> {
    if (this.lastUpdate?.reachableTiles.length) {
      return this.lastUpdate.reachableTiles;
    }

    if (!this.session) {
      return [];
    }

    const reachableTiles = await this.session.listReachable(heroId);
    if (this.lastUpdate) {
      this.lastUpdate = {
        ...this.lastUpdate,
        reachableTiles
      };
    }

    return reachableTiles;
  }
}

export const veilRootWorldBattleActionsMethods = VeilRootWorldBattleActionsMethods.prototype;
