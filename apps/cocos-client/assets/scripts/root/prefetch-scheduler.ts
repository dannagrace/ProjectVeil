// @ts-nocheck

import { getPixelSpriteLoadStatus, loadPixelSpriteAssets } from "./deps.ts";

class VeilRootPrefetchSchedulerMethods {
  [key: string]: any;
  ensurePixelSpriteGroup(group: "boot" | "battle"): void {
    const loadStatus = getPixelSpriteLoadStatus();
    if (loadStatus.loadedGroups.includes(group) || this.pendingPixelSpriteGroups.has(group)) {
      return;
    }

    this.pendingPixelSpriteGroups.add(group);
    void loadPixelSpriteAssets(group)
      .then(() => {
        this.pendingPixelSpriteGroups.delete(group);
        this.renderView();
      })
      .catch(() => {
        this.pendingPixelSpriteGroups.delete(group);
      });
  }

  scheduleFogPulseTick(): void {
    this.scheduleOnce(() => {
      if (!this.fogPulseEnabled) {
        return;
      }

      this.fogPulsePhase = (this.fogPulsePhase + 1) % 2;
      this.mapBoard?.setFogPulsePhase(this.fogPulsePhase);
      if (this.lastUpdate) {
        this.mapBoard?.render(this.lastUpdate);
      }
      this.scheduleFogPulseTick();
    }, Math.max(0.2, this.fogPulseIntervalSeconds));
  }

  syncMusicScene(): void {
    if (this.showLobby) {
      this.audioRuntime.setScene(null);
      return;
    }

    if (this.lastUpdate?.battle) {
      this.audioRuntime.setScene("battle");
      return;
    }

    this.audioRuntime.setScene(this.lastUpdate?.world ? "explore" : null);
  }
}

export const veilRootPrefetchSchedulerMethods = VeilRootPrefetchSchedulerMethods.prototype;
