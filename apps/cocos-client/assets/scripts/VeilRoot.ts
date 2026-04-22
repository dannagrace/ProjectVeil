import { _decorator, Component, input, Input } from "cc";
import {
  cocosPresentationConfig,
  createCocosAudioAssetBridge,
  createCocosAudioRuntime,
  setAssetLoadFailureReporter,
  subscribeAssetLoadFailures
} from "./root/deps.ts";
import { assignVeilRootDefaultState } from "./root/default-state.ts";
import { veilRootAccountSettingsMethods } from "./root/account-settings.ts";
import { veilRootBattleSessionUpdateMethods } from "./root/battle-session-update.ts";
import { veilRootLobbyMatchmakingMethods } from "./root/lobby-matchmaking.ts";
import { veilRootLobbyProgressionMethods } from "./root/lobby-progression.ts";
import { veilRootPrefetchSchedulerMethods } from "./root/prefetch-scheduler.ts";
import { veilRootReportReviewMethods } from "./root/report-review.ts";
import { disposeCurrentSessionForRoot, connectSessionForRoot, refreshSnapshotForRoot } from "./root/session-lifecycle.ts";
export {
  resetVeilRootRuntimeForTests,
  resolveVeilRootRuntime,
  setVeilRootRuntimeForTests
} from "./root/runtime.ts";
import { veilRootRuntimeIntegrationMethods } from "./root/runtime-integration.ts";
import { veilRootViewLayoutMethods } from "./root/view-layout.ts";
import { veilRootWorldBattleActionsMethods } from "./root/world-battle-actions.ts";

const { ccclass, property } = _decorator;

@ccclass("ProjectVeilRoot")
export class VeilRoot extends Component {
  [key: string]: any;

  @property
  roomId = "test-room";

  @property
  playerId = "player-1";

  @property
  displayName = "";

  @property
  seed = 1001;

  @property
  remoteUrl = "http://127.0.0.1:2567";

  @property
  autoConnect = true;

  @property
  tileSize = 84;

  @property
  fogPulseEnabled = true;

  @property
  fogPulseIntervalSeconds = 0.8;

  constructor() {
    super();
    assignVeilRootDefaultState(this);
  }

  onLoad(): void {
    this.audioRuntime.dispose();
    this.stopAssetLoadFailureSubscription?.();
    this.stopGlobalErrorBoundary?.();
    setAssetLoadFailureReporter((event: unknown) => {
      this.trackAssetLoadFailureAnalytics(event);
    });
    this.stopAssetLoadFailureSubscription = subscribeAssetLoadFailures((event: unknown) => {
      this.handleAssetLoadFailure(event);
    });
    this.audioRuntime = createCocosAudioRuntime(cocosPresentationConfig.audio, {
      assetBridge: createCocosAudioAssetBridge(this.node),
      onStateChange: () => {
        this.renderView();
      }
    });
    this.hydrateRuntimePlatform();
    this.hydrateClientPerfRuntimeMetadata();
    this.bindRuntimeMemoryWarnings();
    this.hydrateLaunchIdentity();
    this.hydrateSettings();
    this.syncWechatShareBridge();
    this.stopGlobalErrorBoundary = this.bindGlobalErrorBoundary();
    this.ensureUiCameraVisibility();
    this.ensureViewNodes();
    this.ensureHudActionBinding();
    this.renderView();
  }

  start(): void {
    if (this.fogPulseEnabled) {
      this.scheduleFogPulseTick();
    }

    if (this.showLobby) {
      void this.syncLobbyBootstrap();
      return;
    }

    if (this.autoConnect) {
      void this.connect();
    }
  }

  update(deltaTime: number): void {
    this.trackClientPerfTelemetry(deltaTime);
  }

  onDestroy(): void {
    this.unscheduleAllCallbacks();
    this.stopMatchmakingPolling();
    this.audioRuntime.dispose();
    this.stopAssetLoadFailureSubscription?.();
    this.stopAssetLoadFailureSubscription = null;
    setAssetLoadFailureReporter(null);
    this.stopRuntimeMemoryWarnings?.();
    this.stopRuntimeMemoryWarnings = null;
    this.stopGlobalErrorBoundary?.();
    this.stopGlobalErrorBoundary = null;
    if (this.hudActionBinding) {
      input.off(Input.EventType.TOUCH_END, this.handleHudActionInput, this);
      input.off(Input.EventType.MOUSE_UP, this.handleHudActionInput, this);
      input.off("keydown", this.handleHudKeyboardInput, this);
      this.hudActionBinding = false;
    }

    void disposeCurrentSessionForRoot(this as unknown as Record<string, any>);
  }

  async connect(): Promise<void> {
    await connectSessionForRoot(this as unknown as Record<string, any>);
  }

  async refreshSnapshot(): Promise<void> {
    await refreshSnapshotForRoot(this as unknown as Record<string, any>);
  }
}

function installVeilRootMethods(...sources: object[]): void {
  for (const source of sources) {
    const { constructor: _constructor, ...descriptors } = Object.getOwnPropertyDescriptors(source);
    void _constructor;
    Object.defineProperties(VeilRoot.prototype, descriptors);
  }
}

installVeilRootMethods(
  veilRootViewLayoutMethods,
  veilRootPrefetchSchedulerMethods,
  veilRootLobbyProgressionMethods,
  veilRootReportReviewMethods,
  veilRootWorldBattleActionsMethods,
  veilRootBattleSessionUpdateMethods,
  veilRootLobbyMatchmakingMethods,
  veilRootAccountSettingsMethods,
  veilRootRuntimeIntegrationMethods
);
