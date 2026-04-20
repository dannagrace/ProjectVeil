// @ts-nocheck

import {
  Camera,
  Canvas,
  Color,
  EventMouse,
  EventTouch,
  Graphics,
  input,
  Input,
  Label,
  Layers,
  Node,
  UITransform,
  VeilBattlePanel,
  VeilBattleTransition,
  VeilCampaignPanel,
  VeilEquipmentPanel,
  VeilHudPanel,
  VeilLobbyPanel,
  VeilMapBoard,
  VeilProgressionPanel,
  VeilTimelinePanel,
  VeilTutorialOverlay,
  CocosSettingsPanel,
  assignUiLayer,
  applySettingsUpdate,
  resolveCocosConfigCenterUrl,
  resolveCocosPrivacyPolicyUrl,
  transitionCocosAccountReviewState,
  view,
  type CocosSettingsPanelView
} from "./deps.ts";
import {
  ACCOUNT_REVIEW_PANEL_NODE_NAME,
  BATTLE_NODE_NAME,
  CAMPAIGN_PANEL_NODE_NAME,
  DEFAULT_MAP_HEIGHT_TILES,
  DEFAULT_MAP_WIDTH_TILES,
  EQUIPMENT_PANEL_NODE_NAME,
  HUD_NODE_NAME,
  LOBBY_NODE_NAME,
  MAP_NODE_NAME,
  SETTINGS_BUTTON_NODE_NAME,
  SETTINGS_PANEL_NODE_NAME,
  TIMELINE_NODE_NAME,
  TUTORIAL_OVERLAY_NODE_NAME
} from "./constants";
import { renderViewForRoot } from "./render-state-composer.ts";
import {
  renderGameplayAccountReviewPanelForRoot,
  renderGameplayCampaignPanelForRoot,
  renderGameplayEquipmentPanelForRoot
} from "./panel-orchestration.ts";

class VeilRootViewLayoutMethods {
  [key: string]: any;
  ensureViewNodes(): void {
    assignUiLayer(this.node);

    if (!this.node.getComponent(Canvas)) {
      this.node.addComponent(Canvas);
    }

    const rootTransform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);
    const visibleSize = view.getVisibleSize();
    rootTransform.setContentSize(visibleSize.width, visibleSize.height);
    const { effectiveTileSize, hudWidth, rightWidth, mapWidth, hudHeight, battleHeight, timelineHeight } =
      this.computeLayoutMetrics();

    let hudNode = this.node.getChildByName(HUD_NODE_NAME);
    if (!hudNode) {
      hudNode = new Node(HUD_NODE_NAME);
      hudNode.parent = this.node;
    }
    assignUiLayer(hudNode);

    const hudTransform = hudNode.getComponent(UITransform) ?? hudNode.addComponent(UITransform);
    hudTransform.setContentSize(hudWidth, hudHeight);
    this.hudPanel = hudNode.getComponent(VeilHudPanel) ?? hudNode.addComponent(VeilHudPanel);
    this.hudPanel.configure({
      onNewRun: () => {
        void this.startNewRun();
      },
      onRefresh: () => {
        void this.refreshSnapshot();
      },
      onToggleSettings: () => {
        this.toggleSettingsPanel();
      },
      onToggleCampaign: () => {
        void this.toggleGameplayCampaignPanel();
      },
      onToggleInventory: () => {
        this.toggleGameplayEquipmentPanel();
      },
      onToggleAchievements: () => {
        void this.openGameplayBattleReportCenter();
      },
      onToggleDailyDungeon: () => {
        void this.toggleGameplayDailyDungeonPanel();
      },
      onToggleProgression: () => {
        void this.toggleGameplayBattlePassPanel();
      },
      onToggleSeasonalEvent: () => {
        void this.toggleGameplaySeasonalEventPanel();
      },
      onToggleReport: () => {
        this.toggleReportDialog();
      },
      onToggleSurrender: () => {
        this.toggleSurrenderDialog();
      },
      onShareBattleResult: () => {
        void this.handleBattleResultShare();
      },
      onSubmitReport: (reason) => {
        void this.submitPlayerReport(reason);
      },
      onCancelReport: () => {
        this.closeReportDialog();
      },
      onConfirmSurrender: () => {
        void this.confirmSurrender();
      },
      onCancelSurrender: () => {
        this.closeSurrenderDialog();
      },
      onLearnSkill: (skillId) => {
        void this.learnHeroSkill(skillId);
      },
      onEquipItem: (slot, equipmentId) => {
        void this.equipHeroItem(slot, equipmentId);
      },
      onUnequipItem: (slot) => {
        void this.unequipHeroItem(slot);
      },
      onEndDay: () => {
        void this.advanceDay();
      },
      onReturnLobby: () => {
        void this.returnToLobby();
      }
    });

    let lobbyNode = this.node.getChildByName(LOBBY_NODE_NAME);
    if (!lobbyNode) {
      lobbyNode = new Node(LOBBY_NODE_NAME);
      lobbyNode.parent = this.node;
    }
    assignUiLayer(lobbyNode);
    const lobbyTransform = lobbyNode.getComponent(UITransform) ?? lobbyNode.addComponent(UITransform);
    lobbyTransform.setContentSize(Math.max(360, visibleSize.width - 48), Math.max(620, visibleSize.height - 52));
    this.lobbyPanel = lobbyNode.getComponent(VeilLobbyPanel) ?? lobbyNode.addComponent(VeilLobbyPanel);
    this.lobbyPanel.configure({
      onEditPlayerId: () => {
        this.promptForLobbyField("playerId");
      },
      onEditDisplayName: () => {
        this.promptForLobbyField("displayName");
      },
      onEditRoomId: () => {
        this.promptForLobbyField("roomId");
      },
      onEditLoginId: () => {
        this.promptForLobbyField("loginId");
      },
      onTogglePrivacyConsent: () => {
        this.togglePrivacyConsent();
      },
      onRefresh: () => {
        void this.syncLobbyBootstrap();
      },
      onEnterRoom: () => {
        void this.enterLobbyRoom();
      },
      onEnterMatchmaking: () => {
        void this.enterLobbyMatchmaking();
      },
      onCancelMatchmaking: () => {
        void this.cancelLobbyMatchmaking();
      },
      onLoginAccount: () => {
        void this.loginLobbyAccount();
      },
      onRegisterAccount: () => {
        this.openLobbyAccountFlow("registration");
      },
      onRecoverAccount: () => {
        this.openLobbyAccountFlow("recovery");
      },
      onEditAccountFlowField: (field) => {
        this.promptForAccountFlowField(field);
      },
      onRequestAccountFlow: () => {
        void this.requestActiveAccountFlow();
      },
      onConfirmAccountFlow: () => {
        void this.confirmActiveAccountFlow();
      },
      onToggleAccountMinorProtection: () => {
        this.toggleWechatMinorProtectionSelection();
      },
      onBindWechatAccount: () => {
        void this.bindWechatIdentityFromLobbyAccountFlow();
      },
      onCancelAccountFlow: () => {
        this.closeLobbyAccountFlow();
      },
      onOpenCampaign: () => {
        void this.openLobbyPvePanel("campaign");
      },
      onOpenDailyDungeon: () => {
        void this.openLobbyPvePanel("daily-dungeon");
      },
      onOpenBattlePass: () => {
        void this.openLobbyPvePanel("battle-pass");
      },
      onOpenConfigCenter: () => {
        this.openConfigCenter();
      },
      onLogout: () => {
        this.logoutAuthSession();
      },
      onJoinRoom: (roomId) => {
        void this.enterLobbyRoom(roomId);
      },
      onToggleAccountReview: (open) => {
        if (open) {
          void this.refreshActiveAccountReviewSection();
        }
      },
      onSelectAccountReviewSection: (section) => {
        this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
          type: "section.selected",
          section
        });
        this.renderView();
        void this.refreshActiveAccountReviewSection();
      },
      onSelectAccountReviewPage: (section, page) => {
        this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
          type: "section.selected",
          section
        });
        this.renderView();
        void this.refreshAccountReviewPage(section, page);
      },
      onRetryAccountReviewSection: (section) => {
        void this.refreshActiveAccountReviewSection(section);
      },
      onSelectBattleReplayReview: (replayId) => {
        this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
          type: "battle-replay.selected",
          replayId
        });
        this.renderView();
      },
      onLearnLobbySkill: (skillId) => {
        void this.learnHeroSkill(skillId);
      },
      onPurchaseShopProduct: (productId) => {
        void this.purchaseLobbyShopProduct(productId);
      },
      onClaimDailyQuest: (questId) => {
        void this.claimLobbyDailyQuest(questId);
      },
      onClaimMailboxMessage: (messageId) => {
        void this.claimLobbyMailboxMessage(messageId);
      },
      onClaimAllMailbox: () => {
        void this.claimAllLobbyMailboxMessages();
      }
    });

    let tutorialOverlayNode = this.node.getChildByName(TUTORIAL_OVERLAY_NODE_NAME);
    if (!tutorialOverlayNode) {
      tutorialOverlayNode = new Node(TUTORIAL_OVERLAY_NODE_NAME);
      tutorialOverlayNode.parent = this.node;
    }
    assignUiLayer(tutorialOverlayNode);
    const tutorialOverlayTransform = tutorialOverlayNode.getComponent(UITransform) ?? tutorialOverlayNode.addComponent(UITransform);
    tutorialOverlayTransform.setContentSize(visibleSize.width, visibleSize.height);
    this.tutorialOverlay =
      tutorialOverlayNode.getComponent(VeilTutorialOverlay) ?? tutorialOverlayNode.addComponent(VeilTutorialOverlay);
    this.tutorialOverlay.configure({
      onPrimaryAction: () => {
        void this.handleTutorialPrimaryAction();
      },
      onSecondaryAction: () => {
        void this.skipTutorialFlow();
      }
    });

    let mapRoot = this.node.getChildByName(MAP_NODE_NAME);
    if (!mapRoot) {
      mapRoot = new Node(MAP_NODE_NAME);
      mapRoot.parent = this.node;
    }
    assignUiLayer(mapRoot);

    const mapTransform = mapRoot.getComponent(UITransform) ?? mapRoot.addComponent(UITransform);
    mapTransform.setContentSize(mapWidth, Math.max(480, visibleSize.height - 48));

    this.mapBoard = mapRoot.getComponent(VeilMapBoard) ?? mapRoot.addComponent(VeilMapBoard);
    this.mapBoard.setFogPulsePhase(this.fogPulsePhase);
    this.mapBoard.configure({
      tileSize: effectiveTileSize,
      onTileSelected: (tile) => {
        void this.moveHeroToTile(tile);
      },
      onInputDebug: (message) => {
        this.inputDebug = message;
        this.renderView();
      }
    });

    let battleNode = this.node.getChildByName(BATTLE_NODE_NAME);
    if (!battleNode) {
      battleNode = new Node(BATTLE_NODE_NAME);
      battleNode.parent = this.node;
    }
    assignUiLayer(battleNode);

    const battleTransform = battleNode.getComponent(UITransform) ?? battleNode.addComponent(UITransform);
    battleTransform.setContentSize(rightWidth, battleHeight);
    this.battlePanel = battleNode.getComponent(VeilBattlePanel) ?? battleNode.addComponent(VeilBattlePanel);
    this.battlePanel.configure({
      onSelectTarget: (unitId) => {
        this.selectedBattleTargetId = unitId;
        this.renderView();
      },
      onAction: (action) => {
        void this.actInBattle(action);
      }
    });

    let timelineNode = this.node.getChildByName(TIMELINE_NODE_NAME);
    if (!timelineNode) {
      timelineNode = new Node(TIMELINE_NODE_NAME);
      timelineNode.parent = this.node;
    }
    assignUiLayer(timelineNode);

    const timelineTransform = timelineNode.getComponent(UITransform) ?? timelineNode.addComponent(UITransform);
    timelineTransform.setContentSize(rightWidth, timelineHeight);
    this.timelinePanel = timelineNode.getComponent(VeilTimelinePanel) ?? timelineNode.addComponent(VeilTimelinePanel);

    let accountReviewPanelNode = this.node.getChildByName(ACCOUNT_REVIEW_PANEL_NODE_NAME);
    if (!accountReviewPanelNode) {
      accountReviewPanelNode = new Node(ACCOUNT_REVIEW_PANEL_NODE_NAME);
      accountReviewPanelNode.parent = this.node;
    }
    assignUiLayer(accountReviewPanelNode);
    const accountReviewTransform = accountReviewPanelNode.getComponent(UITransform) ?? accountReviewPanelNode.addComponent(UITransform);
    accountReviewTransform.setContentSize(Math.max(320, Math.min(420, visibleSize.width - 56)), Math.max(360, visibleSize.height - 96));
    this.gameplayAccountReviewPanel =
      accountReviewPanelNode.getComponent(VeilProgressionPanel) ?? accountReviewPanelNode.addComponent(VeilProgressionPanel);
    this.gameplayAccountReviewPanel.configure({
      onClose: () => {
        if (this.gameplayDailyDungeonPanelOpen) {
          void this.toggleGameplayDailyDungeonPanel(false);
          return;
        }
        if (this.gameplayBattlePassPanelOpen) {
          void this.toggleGameplayBattlePassPanel(false);
          return;
        }
        if (this.gameplaySeasonalEventPanelOpen) {
          void this.toggleGameplaySeasonalEventPanel(false);
          return;
        }
        void this.toggleGameplayAccountReviewPanel(false);
      },
      onSelectSection: (section) => {
        this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
          type: "section.selected",
          section
        });
        this.renderView();
        void this.refreshActiveAccountReviewSection();
      },
      onSelectPage: (section, page) => {
        this.lobbyAccountReviewState = transitionCocosAccountReviewState(this.lobbyAccountReviewState, {
          type: "section.selected",
          section
        });
        this.renderView();
        void this.refreshAccountReviewPage(section, page);
      },
      onRetrySection: (section) => {
        void this.refreshActiveAccountReviewSection(section);
      },
      onClaimTier: (tier) => {
        void this.claimGameplaySeasonTier(tier);
      },
      onPurchasePremium: () => {
        void this.purchaseGameplaySeasonPremium();
      },
      onAttemptDailyDungeonFloor: (floor) => {
        void this.attemptGameplayDailyDungeonFloor(floor);
      },
      onClaimDailyDungeonRun: (runId) => {
        void this.claimGameplayDailyDungeonRun(runId);
      },
      onRefreshDailyDungeon: () => {
        void this.refreshDailyDungeonPanel();
      }
    });

    let equipmentPanelNode = this.node.getChildByName(EQUIPMENT_PANEL_NODE_NAME);
    if (!equipmentPanelNode) {
      equipmentPanelNode = new Node(EQUIPMENT_PANEL_NODE_NAME);
      equipmentPanelNode.parent = this.node;
    }
    assignUiLayer(equipmentPanelNode);
    const equipmentPanelTransform = equipmentPanelNode.getComponent(UITransform) ?? equipmentPanelNode.addComponent(UITransform);
    equipmentPanelTransform.setContentSize(Math.max(360, Math.min(460, visibleSize.width - 56)), Math.max(420, visibleSize.height - 96));
    this.gameplayEquipmentPanel =
      equipmentPanelNode.getComponent(VeilEquipmentPanel) ?? equipmentPanelNode.addComponent(VeilEquipmentPanel);
    this.gameplayEquipmentPanel.configure({
      onClose: () => {
        this.toggleGameplayEquipmentPanel(false);
      },
      onEquipItem: (slot, equipmentId) => {
        void this.equipHeroItem(slot, equipmentId);
      },
      onUnequipItem: (slot) => {
        void this.unequipHeroItem(slot);
      }
    });

    let campaignPanelNode = this.node.getChildByName(CAMPAIGN_PANEL_NODE_NAME);
    if (!campaignPanelNode) {
      campaignPanelNode = new Node(CAMPAIGN_PANEL_NODE_NAME);
      campaignPanelNode.parent = this.node;
    }
    assignUiLayer(campaignPanelNode);
    const campaignPanelTransform = campaignPanelNode.getComponent(UITransform) ?? campaignPanelNode.addComponent(UITransform);
    campaignPanelTransform.setContentSize(Math.max(380, Math.min(500, visibleSize.width - 56)), Math.max(480, visibleSize.height - 96));
    this.gameplayCampaignPanel =
      campaignPanelNode.getComponent(VeilCampaignPanel) ?? campaignPanelNode.addComponent(VeilCampaignPanel);
    this.gameplayCampaignPanel.configure({
      onClose: () => {
        void this.toggleGameplayCampaignPanel(false);
      },
      onRefresh: () => {
        void this.refreshGameplayCampaign();
      },
      onSelectPrevious: () => {
        this.selectGameplayCampaignMission("previous");
      },
      onSelectNext: () => {
        this.selectGameplayCampaignMission("next");
      },
      onFocusNextAvailable: () => {
        this.selectGameplayCampaignMission("next-available");
      },
      onStartMission: () => {
        void this.startGameplayCampaignMission();
      },
      onAdvanceDialogue: () => {
        this.advanceGameplayCampaignDialogue();
      },
      onCompleteMission: () => {
        void this.completeGameplayCampaignMission();
      }
    });

    let settingsPanelNode = this.node.getChildByName(SETTINGS_PANEL_NODE_NAME);
    if (!settingsPanelNode) {
      settingsPanelNode = new Node(SETTINGS_PANEL_NODE_NAME);
      settingsPanelNode.parent = this.node;
    }
    assignUiLayer(settingsPanelNode);
    const settingsPanelTransform = settingsPanelNode.getComponent(UITransform) ?? settingsPanelNode.addComponent(UITransform);
    settingsPanelTransform.setContentSize(Math.max(360, Math.min(460, visibleSize.width - 64)), Math.max(440, visibleSize.height - 96));
    this.settingsPanel = settingsPanelNode.getComponent(CocosSettingsPanel) ?? settingsPanelNode.addComponent(CocosSettingsPanel);
    this.settingsPanel.configure({
      onClose: () => {
        this.toggleSettingsPanel(false);
      },
      onUpdate: (update) => {
        this.updateSettings(update);
      },
      onLogout: () => {
        void this.handleSettingsLogout();
      },
      onDeleteAccount: () => {
        void this.handleSettingsDeleteAccount();
      },
      onWithdrawConsent: () => {
        void this.handleSettingsWithdrawConsent();
      },
      onOpenPrivacyPolicy: () => {
        this.openSettingsPrivacyPolicy();
      },
      onSubmitSupportTicket: (category) => {
        void this.handleSettingsSupportTicket(category);
      }
    });

    let settingsButtonNode = this.node.getChildByName(SETTINGS_BUTTON_NODE_NAME);
    if (!settingsButtonNode) {
      settingsButtonNode = new Node(SETTINGS_BUTTON_NODE_NAME);
      settingsButtonNode.parent = this.node;
    }
    assignUiLayer(settingsButtonNode);
    const settingsButtonTransform = settingsButtonNode.getComponent(UITransform) ?? settingsButtonNode.addComponent(UITransform);
    settingsButtonTransform.setContentSize(58, 58);

    this.battleTransition = this.node.getComponent(VeilBattleTransition) ?? this.node.addComponent(VeilBattleTransition);
    this.updateLayout();
  }

  ensureUiCameraVisibility(): void {
    const sceneRoot = this.node.parent;
    if (!sceneRoot) {
      return;
    }

    const uiLayer = Layers.Enum.UI_2D;
    const cameraNode = sceneRoot.getChildByName("Main Camera");
    const camera = cameraNode?.getComponent(Camera) ?? null;
    if (camera) {
      camera.visibility |= uiLayer;
      camera.orthoHeight = Math.max(320, view.getVisibleSize().height / 2);
      camera.near = 0.1;
      camera.far = 4000;
    }
    if (cameraNode) {
      cameraNode.setPosition(0, 0, 1000);
      cameraNode.setRotationFromEuler(0, 0, 0);
    }
  }

  ensureHudActionBinding(): void {
    if (this.hudActionBinding) {
      return;
    }

    input.on(Input.EventType.TOUCH_END, this.handleHudActionInput, this);
    input.on(Input.EventType.MOUSE_UP, this.handleHudActionInput, this);
    this.hudActionBinding = true;
  }

  renderView(): void {
    renderViewForRoot(this as unknown as Record<string, any>);
  }

  renderGameplayEquipmentPanel(): void {
    renderGameplayEquipmentPanelForRoot(this as unknown as Record<string, any>);
  }

  renderGameplayCampaignPanel(): void {
    renderGameplayCampaignPanelForRoot(this as unknown as Record<string, any>);
  }

  renderGameplayAccountReviewPanel(): void {
    renderGameplayAccountReviewPanelForRoot(this as unknown as Record<string, any>);
  }

  formatLobbyVaultSummary(): string {
    const resources = this.lobbyAccountProfile.globalResources;
    const ownedCosmetics = this.lobbyAccountProfile.cosmeticInventory?.ownedIds.length ?? 0;
    const equippedBorder = this.lobbyAccountProfile.equippedCosmetics?.profileBorderId ?? "未装备";
    return `全局仓库 金币 ${resources.gold} / 木材 ${resources.wood} / 矿石 ${resources.ore} / 宝石 ${this.lobbyAccountProfile.gems ?? 0} / 外观 ${ownedCosmetics} 件 / 边框 ${equippedBorder}`;
  }

  openConfigCenter(): void {
    const configCenterUrl = resolveCocosConfigCenterUrl(this.remoteUrl);
    if (this.runtimeCapabilities.configCenterAccess !== "external-window") {
      this.lobbyStatus = `当前${this.runtimePlatform === "wechat-game" ? "微信小游戏" : "运行"}环境不支持直接打开配置台，请在 H5 调试壳访问 ${configCenterUrl}`;
      this.renderView();
      return;
    }

    const openRef = globalThis.open;
    if (typeof openRef === "function") {
      openRef(configCenterUrl, "_blank", "noopener,noreferrer");
      this.lobbyStatus = "已在新窗口打开配置台。";
    } else {
      this.lobbyStatus = `当前运行环境无法直接打开配置台，请访问 ${configCenterUrl}`;
    }
    this.renderView();
  }

  computeLayoutMetrics(): {
    effectiveTileSize: number;
    hudWidth: number;
    rightWidth: number;
    mapWidth: number;
    hudHeight: number;
    battleHeight: number;
    timelineHeight: number;
  } {
    const visibleSize = view.getVisibleSize();
    const hudWidth = Math.max(228, Math.min(264, Math.floor(visibleSize.width * 0.215)));
    const rightWidth = Math.max(244, Math.min(276, Math.floor(visibleSize.width * 0.205)));
    const effectiveTileSize = this.computeEffectiveTileSize(hudWidth, rightWidth);
    const mapWidth = this.currentMapPixelWidth(effectiveTileSize);
    const hudHeight = Math.max(318, visibleSize.height - 52);
    const battleHeight = Math.max(132, Math.floor((visibleSize.height - 72) * 0.23));
    const timelineHeight = Math.max(226, visibleSize.height - battleHeight - 74);

    return {
      effectiveTileSize,
      hudWidth,
      rightWidth,
      mapWidth,
      hudHeight,
      battleHeight,
      timelineHeight
    };
  }

  computeEffectiveTileSize(hudWidth: number, rightWidth: number): number {
    const visibleSize = view.getVisibleSize();
    const margin = 24;
    const widthTiles = this.lastUpdate?.world.map.width ?? DEFAULT_MAP_WIDTH_TILES;
    const heightTiles = this.lastUpdate?.world.map.height ?? DEFAULT_MAP_HEIGHT_TILES;
    const availableWidth = Math.max(240, visibleSize.width - hudWidth - rightWidth - margin * 4);
    const availableHeight = Math.max(320, visibleSize.height - margin * 2);
    const widthBound = Math.floor(availableWidth / widthTiles);
    const heightBound = Math.floor(availableHeight / heightTiles);
    return Math.max(36, Math.min(this.tileSize, widthBound, heightBound));
  }

  currentMapPixelWidth(tileSize = this.tileSize): number {
    const widthTiles = this.lastUpdate?.world.map.width ?? DEFAULT_MAP_WIDTH_TILES;
    return widthTiles * tileSize;
  }

  currentMapPixelHeight(tileSize = this.tileSize): number {
    const heightTiles = this.lastUpdate?.world.map.height ?? DEFAULT_MAP_HEIGHT_TILES;
    return heightTiles * tileSize;
  }

  updateLayout(): void {
    const visibleSize = view.getVisibleSize();
    const margin = 24;
    const { effectiveTileSize, hudWidth, rightWidth, mapWidth, hudHeight, battleHeight, timelineHeight } =
      this.computeLayoutMetrics();
    const mapHeight = Math.max(this.currentMapPixelHeight(effectiveTileSize), visibleSize.height - margin * 2);

    const hudNode = this.node.getChildByName(HUD_NODE_NAME);
    const mapNode = this.node.getChildByName(MAP_NODE_NAME);
    const battleNode = this.node.getChildByName(BATTLE_NODE_NAME);
    const timelineNode = this.node.getChildByName(TIMELINE_NODE_NAME);
    const lobbyNode = this.node.getChildByName(LOBBY_NODE_NAME);
    const accountReviewPanelNode = this.node.getChildByName(ACCOUNT_REVIEW_PANEL_NODE_NAME);
    const equipmentPanelNode = this.node.getChildByName(EQUIPMENT_PANEL_NODE_NAME);
    const campaignPanelNode = this.node.getChildByName(CAMPAIGN_PANEL_NODE_NAME);
    const settingsPanelNode = this.node.getChildByName(SETTINGS_PANEL_NODE_NAME);
    const settingsButtonNode = this.node.getChildByName(SETTINGS_BUTTON_NODE_NAME);

    this.mapBoard?.configure({
      tileSize: effectiveTileSize,
      onTileSelected: (tile) => {
        void this.moveHeroToTile(tile);
      },
      onInputDebug: (message) => {
        this.inputDebug = message;
        this.renderView();
      }
    });

    if (hudNode) {
      const hudTransform = hudNode.getComponent(UITransform) ?? hudNode.addComponent(UITransform);
      hudTransform.setContentSize(hudWidth, hudHeight);
      hudNode.setPosition(-visibleSize.width / 2 + margin + hudWidth / 2, 56, 0);
      this.hudPanel?.configure({
        onNewRun: () => {
          void this.startNewRun();
        },
        onRefresh: () => {
          void this.refreshSnapshot();
        },
        onToggleSettings: () => {
          this.toggleSettingsPanel();
        },
        onToggleCampaign: () => {
          void this.toggleGameplayCampaignPanel();
        },
        onToggleInventory: () => {
          this.toggleGameplayEquipmentPanel();
        },
        onToggleAchievements: () => {
          void this.openGameplayBattleReportCenter();
        },
        onToggleDailyDungeon: () => {
          void this.toggleGameplayDailyDungeonPanel();
        },
        onToggleProgression: () => {
          void this.toggleGameplayBattlePassPanel();
        },
        onToggleReport: () => {
          this.toggleReportDialog();
        },
        onToggleSurrender: () => {
          this.toggleSurrenderDialog();
        },
        onSubmitReport: (reason) => {
          void this.submitPlayerReport(reason);
        },
        onCancelReport: () => {
          this.closeReportDialog();
        },
        onConfirmSurrender: () => {
          void this.confirmSurrender();
        },
        onCancelSurrender: () => {
          this.closeSurrenderDialog();
        },
        onLearnSkill: (skillId) => {
          void this.learnHeroSkill(skillId);
        },
        onEquipItem: (slot, equipmentId) => {
          void this.equipHeroItem(slot, equipmentId);
        },
        onUnequipItem: (slot) => {
          void this.unequipHeroItem(slot);
        },
        onEndDay: () => {
          void this.advanceDay();
        },
        onReturnLobby: () => {
          void this.returnToLobby();
        },
        onInteractionAction: (actionId) => {
          const tile = this.selectedInteractionTile();
          if (!tile?.building) {
            return;
          }
          if (actionId === "recruit" || actionId === "visit" || actionId === "claim" || actionId === "upgrade") {
            void this.executeBuildingInteraction(tile, actionId);
          }
        }
      });
    }

    if (mapNode) {
      const mapTransform = mapNode.getComponent(UITransform) ?? mapNode.addComponent(UITransform);
      mapTransform.setContentSize(mapWidth, mapHeight);
      const mapLeft = -visibleSize.width / 2 + margin + hudWidth + margin;
      mapNode.setPosition(mapLeft + mapWidth / 2, 0, 0);
    }

    if (battleNode) {
      const battleTransform = battleNode.getComponent(UITransform) ?? battleNode.addComponent(UITransform);
      battleTransform.setContentSize(rightWidth, battleHeight);
      battleNode.setPosition(
        visibleSize.width / 2 - margin - rightWidth / 2,
        visibleSize.height / 2 - margin - battleHeight / 2 + 2,
        0
      );
    }

    if (timelineNode) {
      const timelineTransform = timelineNode.getComponent(UITransform) ?? timelineNode.addComponent(UITransform);
      timelineTransform.setContentSize(rightWidth, timelineHeight);
      timelineNode.setPosition(
        visibleSize.width / 2 - margin - rightWidth / 2,
        -visibleSize.height / 2 + margin + timelineHeight / 2 + 8,
        0
      );
    }

    if (lobbyNode) {
      const lobbyTransform = lobbyNode.getComponent(UITransform) ?? lobbyNode.addComponent(UITransform);
      lobbyTransform.setContentSize(Math.max(360, Math.min(860, visibleSize.width - 40)), Math.max(520, visibleSize.height - 48));
      lobbyNode.setPosition(0, 0, 0);
    }

    if (accountReviewPanelNode) {
      const accountReviewTransform =
        accountReviewPanelNode.getComponent(UITransform) ?? accountReviewPanelNode.addComponent(UITransform);
      accountReviewTransform.setContentSize(Math.max(320, Math.min(420, visibleSize.width - 56)), Math.max(360, visibleSize.height - 96));
      accountReviewPanelNode.setPosition(0, 0, 4);
    }

    if (equipmentPanelNode) {
      const equipmentPanelTransform =
        equipmentPanelNode.getComponent(UITransform) ?? equipmentPanelNode.addComponent(UITransform);
      equipmentPanelTransform.setContentSize(Math.max(360, Math.min(460, visibleSize.width - 56)), Math.max(420, visibleSize.height - 96));
      equipmentPanelNode.setPosition(0, 0, 4);
    }

    if (campaignPanelNode) {
      const campaignPanelTransform =
        campaignPanelNode.getComponent(UITransform) ?? campaignPanelNode.addComponent(UITransform);
      campaignPanelTransform.setContentSize(Math.max(380, Math.min(500, visibleSize.width - 56)), Math.max(480, visibleSize.height - 96));
      campaignPanelNode.setPosition(0, 0, 5);
    }

    if (settingsPanelNode) {
      const settingsPanelTransform =
        settingsPanelNode.getComponent(UITransform) ?? settingsPanelNode.addComponent(UITransform);
      settingsPanelTransform.setContentSize(Math.max(360, Math.min(460, visibleSize.width - 64)), Math.max(440, visibleSize.height - 96));
      settingsPanelNode.setPosition(0, 0, 6);
    }

    if (settingsButtonNode) {
      const buttonTransform = settingsButtonNode.getComponent(UITransform) ?? settingsButtonNode.addComponent(UITransform);
      buttonTransform.setContentSize(58, 58);
      settingsButtonNode.setPosition(visibleSize.width / 2 - margin - 34, visibleSize.height / 2 - margin - 34, 7);
      this.renderSettingsButton();
    }
  }

  handleHudActionInput(...args: unknown[]): void {
    this.audioRuntime.unlock();
    const event = args[0] as EventTouch | EventMouse | undefined;
    if (!event) {
      return;
    }

    const visibleSize = view.getVisibleSize();
    const centeredX = event.getUILocation().x - visibleSize.width / 2;
    const centeredY = event.getUILocation().y - visibleSize.height / 2;
    const settingsButtonNode = this.node.getChildByName(SETTINGS_BUTTON_NODE_NAME);
    if (this.pointInRootNode(centeredX, centeredY, settingsButtonNode)) {
      this.toggleSettingsPanel();
      this.inputDebug = "button settings-fab";
      return;
    }

    const settingsPanelNode = this.node.getChildByName(SETTINGS_PANEL_NODE_NAME);
    const settingsPanelTransform = settingsPanelNode?.getComponent(UITransform) ?? null;
    if (this.settingsView.open && settingsPanelNode && settingsPanelTransform) {
      const settingsLocalX = centeredX - settingsPanelNode.position.x;
      const settingsLocalY = centeredY - settingsPanelNode.position.y;
      if (
        settingsLocalX >= -settingsPanelTransform.width / 2
        && settingsLocalX <= settingsPanelTransform.width / 2
        && settingsLocalY >= -settingsPanelTransform.height / 2
        && settingsLocalY <= settingsPanelTransform.height / 2
      ) {
        const action = this.settingsPanel?.dispatchPointerUp(settingsLocalX, settingsLocalY) ?? null;
        if (action) {
          this.inputDebug = `button ${action}`;
        }
        return;
      }
    }

    if (this.showLobby) {
      return;
    }

    const hudNode = this.node.getChildByName(HUD_NODE_NAME);
    const hudTransform = hudNode?.getComponent(UITransform) ?? null;
    if (!hudNode || !hudTransform) {
      return;
    }

    const hudLocalX = centeredX - hudNode.position.x;
    const hudLocalY = centeredY - hudNode.position.y;
    if (
      hudLocalX < -hudTransform.width / 2 ||
      hudLocalX > hudTransform.width / 2 ||
      hudLocalY < -hudTransform.height / 2 ||
      hudLocalY > hudTransform.height / 2
    ) {
      return;
    }

    const action = this.hudPanel?.dispatchPointerUp(hudLocalX, hudLocalY) ?? null;
    if (!action) {
      return;
    }

    this.inputDebug = `button ${action}`;
  }

  buildSettingsView(): CocosSettingsPanelView {
    return applySettingsUpdate(this.settingsView, {
      displayName: this.displayName || this.playerId,
      loginId: this.loginId,
      authMode: this.authMode,
      privacyConsentAccepted: this.privacyConsentAccepted,
      supportSubmittingCategory: this.supportTicketSubmittingCategory,
      privacyPolicyUrl: resolveCocosPrivacyPolicyUrl(globalThis.location)
    });
  }

  renderSettingsOverlay(): void {
    this.settingsView = this.buildSettingsView();
    this.settingsPanel?.render(this.settingsView);
    this.renderSettingsButton();
  }

  renderSettingsButton(): void {
    const buttonNode = this.node.getChildByName(SETTINGS_BUTTON_NODE_NAME);
    if (!buttonNode) {
      return;
    }

    assignUiLayer(buttonNode);
    const transform = buttonNode.getComponent(UITransform) ?? buttonNode.addComponent(UITransform);
    const width = transform.width || 58;
    const height = transform.height || 58;
    const graphics = buttonNode.getComponent(Graphics) ?? buttonNode.addComponent(Graphics);
    graphics.clear();
    graphics.fillColor = this.settingsView.open ? new Color(108, 88, 54, 244) : new Color(52, 68, 92, 236);
    graphics.strokeColor = this.settingsView.open ? new Color(244, 225, 180, 164) : new Color(226, 236, 248, 96);
    graphics.lineWidth = 2;
    graphics.roundRect(-width / 2, -height / 2, width, height, 16);
    graphics.fill();
    graphics.stroke();
    graphics.fillColor = new Color(255, 255, 255, 18);
    graphics.roundRect(-width / 2 + 10, height / 2 - 14, width - 20, 4, 2);
    graphics.fill();

    const labelNode = buttonNode.getChildByName("Label") ?? new Node("Label");
    labelNode.parent = buttonNode;
    assignUiLayer(labelNode);
    const labelTransform = labelNode.getComponent(UITransform) ?? labelNode.addComponent(UITransform);
    labelTransform.setContentSize(width - 8, height - 8);
    labelNode.setPosition(0, 0, 1);
    const label = labelNode.getComponent(Label) ?? labelNode.addComponent(Label);
    label.string = "⚙";
    label.fontSize = 26;
    label.lineHeight = 28;
    label.horizontalAlign = 1;
    label.verticalAlign = 1;
    label.enableWrapText = false;
    label.color = new Color(244, 247, 252, 255);
  }

  pointInRootNode(centeredX: number, centeredY: number, node: Node | null): boolean {
    if (!node || !node.active) {
      return false;
    }

    const transform = node.getComponent(UITransform) ?? null;
    if (!transform) {
      return false;
    }

    return (
      centeredX >= node.position.x - transform.width / 2
      && centeredX <= node.position.x + transform.width / 2
      && centeredY >= node.position.y - transform.height / 2
      && centeredY <= node.position.y + transform.height / 2
    );
  }
}

export const veilRootViewLayoutMethods = VeilRootViewLayoutMethods.prototype;
