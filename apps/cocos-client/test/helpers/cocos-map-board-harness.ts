import { Node, view } from "cc";
import { VeilMapBoard } from "../../assets/scripts/VeilMapBoard.ts";
import type { PlayerTileView, SessionUpdate, Vec2 } from "../../assets/scripts/VeilCocosSession.ts";
import { createComponentHarness } from "./cocos-panel-harness.ts";

type TileNodeView = {
  fogOverlay: {
    render: (style: unknown, enabled?: boolean) => void;
  };
};

type ObjectNodeView = {
  node: { active: boolean };
  label: { string: string };
  spriteNode: { active: boolean };
};

type FeedbackNodeView = {
  node: { active: boolean };
  label: { string: string };
};

type VeilMapBoardState = VeilMapBoard & {
  tileNodes: Map<string, TileNodeView>;
  objectNodes: Map<string, ObjectNodeView>;
  feedbackNodes: Map<string, FeedbackNodeView>;
  emptyStateLabel: { string: string } | null;
  emptyStateNode: { active: boolean } | null;
  heroNode: { active: boolean } | null;
  inputOverlayNode: Node | null;
};

interface CreateMapBoardHarnessOptions {
  width: number;
  height: number;
  tileSize?: number;
  onTileSelected?: (tile: PlayerTileView) => void;
  onInputDebug?: (message: string) => void;
}

export function createMapBoardHarness(options: CreateMapBoardHarnessOptions) {
  const { node, component } = createComponentHarness(VeilMapBoard, {
    name: "MapBoardRoot",
    width: options.width,
    height: options.height
  });
  component.configure({
    tileSize: options.tileSize ?? 48,
    onTileSelected: options.onTileSelected,
    onInputDebug: options.onInputDebug
  });

  const state = () => component as VeilMapBoardState;

  return {
    node,
    component,
    render(update: SessionUpdate | null): void {
      component.render(update);
    },
    destroy(): void {
      component.onDestroy();
    },
    emptyStateText(): string {
      return String(state().emptyStateLabel?.string ?? "");
    },
    heroActive(): boolean | undefined {
      return state().heroNode?.active;
    },
    inputOverlayActive(): boolean | undefined {
      return state().inputOverlayNode?.active;
    },
    hasTile(key: string): boolean {
      return state().tileNodes.has(key);
    },
    objectNode(key: string): ObjectNodeView | undefined {
      return state().objectNodes.get(key);
    },
    feedbackNode(key: string): FeedbackNodeView | undefined {
      return state().feedbackNodes.get(key);
    },
    captureFogStyles(key: string): Array<Record<string, number | string | null>> {
      const tileNode = state().tileNodes.get(key);
      if (!tileNode) {
        return [];
      }

      const captured: Array<Record<string, number | string | null>> = [];
      const originalRender = tileNode.fogOverlay.render.bind(tileNode.fogOverlay);
      tileNode.fogOverlay.render = (style, enabled) => {
        captured.push((style ?? null) as Record<string, number | string | null>);
        originalRender(style, enabled);
      };
      return captured;
    },
    tapTile(update: SessionUpdate, position: Vec2, eventType = Node.EventType.TOUCH_END): void {
      const overlay = state().inputOverlayNode ?? node;
      const visibleSize = view.getVisibleSize();
      const mapWidth = update.world.map.width * component.tileSize;
      const mapHeight = update.world.map.height * component.tileSize;
      const localX = -mapWidth / 2 + position.x * component.tileSize + component.tileSize / 2;
      const localY = mapHeight / 2 - position.y * component.tileSize - component.tileSize / 2;
      const uiX = localX + node.position.x + visibleSize.width / 2;
      const uiY = localY + node.position.y + visibleSize.height / 2;
      overlay.emit(eventType, {
        getUILocation: () => ({ x: uiX, y: uiY })
      });
    }
  };
}
