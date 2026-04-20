export const cocosPanelAuthoringTargets = [
  {
    viewFile: "apps/cocos-client/assets/scripts/VeilBattlePanel.ts",
    modelImport: "./cocos-battle-panel-model.ts",
  },
  {
    viewFile: "apps/cocos-client/assets/scripts/VeilCampaignPanel.ts",
    modelImport: "./cocos-campaign-panel-model.ts",
  },
  {
    viewFile: "apps/cocos-client/assets/scripts/VeilEquipmentPanel.ts",
    modelImport: "./cocos-equipment-panel-model.ts",
  },
  {
    viewFile: "apps/cocos-client/assets/scripts/VeilHudPanel.ts",
    modelImport: "./cocos-hud-panel-model.ts",
  },
  {
    viewFile: "apps/cocos-client/assets/scripts/VeilLobbyPanel.ts",
    modelImport: "./cocos-lobby-panel-model.ts",
  },
  {
    viewFile: "apps/cocos-client/assets/scripts/VeilMapBoard.ts",
    modelImport: "./cocos-map-board-model.ts",
    allowedValueImports: [
      "./VeilFogOverlay.ts",
      "./VeilTilemapRenderer.ts",
      "./VeilUnitAnimator.ts",
    ],
  },
  {
    viewFile: "apps/cocos-client/assets/scripts/VeilProgressionPanel.ts",
    modelImport: "./cocos-progression-panel-model.ts",
  },
  {
    viewFile: "apps/cocos-client/assets/scripts/VeilTimelinePanel.ts",
    modelImport: "./cocos-timeline-panel-model.ts",
  },
  {
    viewFile: "apps/cocos-client/assets/scripts/cocos-settings-panel.ts",
    modelImport: "./cocos-settings-panel-model.ts",
  },
];
