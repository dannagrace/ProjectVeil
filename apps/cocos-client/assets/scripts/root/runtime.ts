import { VeilCocosSession } from "../VeilCocosSession.ts";
import {
  attemptCocosDailyDungeonFloor,
  claimCocosDailyDungeonRunReward,
  claimCocosDailyQuest,
  claimCocosSeasonTier,
  completeCocosCampaignMission,
  deleteCurrentCocosPlayerAccount,
  loadCocosActiveSeasonalEvents,
  loadCocosAnnouncements,
  loadCocosBattleReplayHistoryPage,
  loadCocosCampaignSummary,
  loadCocosDailyDungeon,
  loadCocosLobbyRooms,
  loadCocosMaintenanceMode,
  loadCocosPlayerAccountProfile,
  loadCocosPlayerAchievementProgress,
  loadCocosPlayerEventHistory,
  loadCocosPlayerProgressionSnapshot,
  loadCocosSeasonProgress,
  loginCocosGuestAuthSession,
  logoutCurrentCocosAuthSession,
  postCocosPlayerReferral,
  startCocosCampaignMission,
  submitCocosSeasonalEventProgress,
  submitCocosSupportTicket,
  syncCurrentCocosAuthSession,
  updateCocosTutorialProgress
} from "../cocos-lobby.ts";
import { startCocosMatchmakingStatusPolling } from "../cocos-matchmaking.ts";

export interface VeilRootRuntime {
  createSession: typeof VeilCocosSession.create;
  loadLeaderboard: typeof VeilCocosSession.fetchLeaderboard;
  loadFriendLeaderboard: typeof VeilCocosSession.fetchFriendLeaderboard;
  enqueueMatchmaking: typeof VeilCocosSession.enqueueForMatchmaking;
  getMatchmakingStatus: typeof VeilCocosSession.getMatchmakingStatus;
  cancelMatchmaking: typeof VeilCocosSession.cancelMatchmaking;
  startMatchmakingPolling: typeof startCocosMatchmakingStatusPolling;
  readStoredReplay: typeof VeilCocosSession.readStoredReplay;
  loadLobbyRooms: typeof loadCocosLobbyRooms;
  loadAnnouncements: typeof loadCocosAnnouncements;
  loadMaintenanceMode: typeof loadCocosMaintenanceMode;
  syncAuthSession: typeof syncCurrentCocosAuthSession;
  loadAccountProfile: typeof loadCocosPlayerAccountProfile;
  updateTutorialProgress: typeof updateCocosTutorialProgress;
  loadProgressionSnapshot: typeof loadCocosPlayerProgressionSnapshot;
  loadCampaignSummary: typeof loadCocosCampaignSummary;
  startCampaignMission: typeof startCocosCampaignMission;
  completeCampaignMission: typeof completeCocosCampaignMission;
  loadAchievementProgress: typeof loadCocosPlayerAchievementProgress;
  loadEventHistory: typeof loadCocosPlayerEventHistory;
  loadBattleReplayHistoryPage: typeof loadCocosBattleReplayHistoryPage;
  loadSeasonProgress: typeof loadCocosSeasonProgress;
  loadDailyDungeon: typeof loadCocosDailyDungeon;
  loadActiveSeasonalEvents: typeof loadCocosActiveSeasonalEvents;
  submitSeasonalEventProgress: typeof submitCocosSeasonalEventProgress;
  claimSeasonTier: typeof claimCocosSeasonTier;
  attemptDailyDungeonFloor: typeof attemptCocosDailyDungeonFloor;
  claimDailyDungeonRunReward: typeof claimCocosDailyDungeonRunReward;
  loginGuestAuthSession: typeof loginCocosGuestAuthSession;
  postPlayerReferral: typeof postCocosPlayerReferral;
  logoutAuthSession: typeof logoutCurrentCocosAuthSession;
  deletePlayerAccount: typeof deleteCurrentCocosPlayerAccount;
  loadShopProducts: typeof VeilCocosSession.fetchShopProducts;
  purchaseShopProduct: typeof VeilCocosSession.purchaseShopProduct;
  equipShopCosmetic: typeof VeilCocosSession.equipShopCosmetic;
  claimDailyQuest: typeof claimCocosDailyQuest;
  submitSupportTicket: typeof submitCocosSupportTicket;
}

const defaultVeilRootRuntime: VeilRootRuntime = {
  createSession: (...args) => VeilCocosSession.create(...args),
  loadLeaderboard: (...args) => VeilCocosSession.fetchLeaderboard(...args),
  loadFriendLeaderboard: (...args) => VeilCocosSession.fetchFriendLeaderboard(...args),
  enqueueMatchmaking: (...args) => VeilCocosSession.enqueueForMatchmaking(...args),
  getMatchmakingStatus: (...args) => VeilCocosSession.getMatchmakingStatus(...args),
  cancelMatchmaking: (...args) => VeilCocosSession.cancelMatchmaking(...args),
  startMatchmakingPolling: (...args) => startCocosMatchmakingStatusPolling(...args),
  readStoredReplay: (...args) => VeilCocosSession.readStoredReplay(...args),
  loadLobbyRooms: (...args) => loadCocosLobbyRooms(...args),
  loadAnnouncements: (...args) => loadCocosAnnouncements(...args),
  loadMaintenanceMode: (...args) => loadCocosMaintenanceMode(...args),
  syncAuthSession: (...args) => syncCurrentCocosAuthSession(...args),
  loadAccountProfile: (...args) => loadCocosPlayerAccountProfile(...args),
  updateTutorialProgress: (...args) => updateCocosTutorialProgress(...args),
  loadProgressionSnapshot: (...args) => loadCocosPlayerProgressionSnapshot(...args),
  loadCampaignSummary: (...args) => loadCocosCampaignSummary(...args),
  startCampaignMission: (...args) => startCocosCampaignMission(...args),
  completeCampaignMission: (...args) => completeCocosCampaignMission(...args),
  loadAchievementProgress: (...args) => loadCocosPlayerAchievementProgress(...args),
  loadEventHistory: (...args) => loadCocosPlayerEventHistory(...args),
  loadBattleReplayHistoryPage: (...args) => loadCocosBattleReplayHistoryPage(...args),
  loadSeasonProgress: (...args) => loadCocosSeasonProgress(...args),
  loadDailyDungeon: (...args) => loadCocosDailyDungeon(...args),
  loadActiveSeasonalEvents: (...args) => loadCocosActiveSeasonalEvents(...args),
  submitSeasonalEventProgress: (...args) => submitCocosSeasonalEventProgress(...args),
  claimSeasonTier: (...args) => claimCocosSeasonTier(...args),
  attemptDailyDungeonFloor: (...args) => attemptCocosDailyDungeonFloor(...args),
  claimDailyDungeonRunReward: (...args) => claimCocosDailyDungeonRunReward(...args),
  loginGuestAuthSession: (...args) => loginCocosGuestAuthSession(...args),
  postPlayerReferral: (...args) => postCocosPlayerReferral(...args),
  logoutAuthSession: (...args) => logoutCurrentCocosAuthSession(...args),
  deletePlayerAccount: (...args) => deleteCurrentCocosPlayerAccount(...args),
  loadShopProducts: (...args) => VeilCocosSession.fetchShopProducts(...args),
  purchaseShopProduct: (...args) => VeilCocosSession.purchaseShopProduct(...args),
  equipShopCosmetic: (...args) => VeilCocosSession.equipShopCosmetic(...args),
  claimDailyQuest: (...args) => claimCocosDailyQuest(...args),
  submitSupportTicket: (...args) => submitCocosSupportTicket(...args)
};

let testVeilRootRuntimeOverrides: Partial<VeilRootRuntime> | null = null;

export function resolveVeilRootRuntime(): VeilRootRuntime {
  return {
    ...defaultVeilRootRuntime,
    ...testVeilRootRuntimeOverrides
  };
}

export function setVeilRootRuntimeForTests(runtime: Partial<VeilRootRuntime>): void {
  // Tests only replace transport/persistence edges here so the VeilRoot boot,
  // reconnect, and handoff orchestration still runs through the production code.
  testVeilRootRuntimeOverrides = {
    ...testVeilRootRuntimeOverrides,
    ...runtime
  };
}

export function resetVeilRootRuntimeForTests(): void {
  testVeilRootRuntimeOverrides = null;
}
