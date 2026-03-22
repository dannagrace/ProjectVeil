import { Layers, Node } from "cc";

export function assignUiLayer(node: Node): void {
  node.layer = Layers.Enum.UI_2D;
}
