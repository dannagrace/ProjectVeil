import fs from "node:fs";
import path from "node:path";

function toPascalCase(input: string): string {
  return input
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function toKebabCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

const args = process.argv.slice(2);
const rawName = args[0] === "--name" ? args[1] : args[0];

if (!rawName) {
  console.error("Usage: node --import tsx ./scripts/generate-cocos-panel.ts --name QuestTracker");
  process.exit(1);
}

const panelName = toPascalCase(rawName);
const kebabName = toKebabCase(panelName);
const scriptsDir = path.resolve("apps/cocos-client/assets/scripts");
const testsDir = path.resolve("apps/cocos-client/test");
const panelFile = path.join(scriptsDir, `Veil${panelName}Panel.ts`);
const modelFile = path.join(scriptsDir, `cocos-${kebabName}-panel-model.ts`);
const testFile = path.join(testsDir, `cocos-${kebabName}-panel-model.test.ts`);

const modelTemplate = `export interface ${panelName}PanelInput {\n  title: string;\n  detailLines: string[];\n}\n\nexport interface ${panelName}PanelViewModel {\n  headerLines: string[];\n  detailLines: string[];\n}\n\nexport function build${panelName}PanelViewModel(input: ${panelName}PanelInput): ${panelName}PanelViewModel {\n  return {\n    headerLines: [input.title],\n    detailLines: input.detailLines,\n  };\n}\n`;

const panelTemplate = `import { _decorator, Component, Label, Node, UITransform } from "cc";\nimport { assignUiLayer } from "./cocos-ui-layer.ts";\nimport {\n  build${panelName}PanelViewModel,\n  type ${panelName}PanelInput,\n} from "./cocos-${kebabName}-panel-model.ts";\n\nconst { ccclass } = _decorator;\nconst H_ALIGN_LEFT = 0;\nconst V_ALIGN_TOP = 0;\nconst OVERFLOW_RESIZE_HEIGHT = 3;\n\n@ccclass("ProjectVeil${panelName}Panel")\nexport class Veil${panelName}Panel extends Component {\n  private label: Label | null = null;\n\n  render(state: ${panelName}PanelInput): void {\n    const view = build${panelName}PanelViewModel(state);\n    const label = this.ensureLabel();\n    label.string = [...view.headerLines, ...view.detailLines].join("\\n");\n  }\n\n  private ensureLabel(): Label {\n    const existingNode = this.node.getChildByName("${panelName}Content");\n    const contentNode = existingNode ?? new Node("${panelName}Content");\n    if (!existingNode) {\n      contentNode.parent = this.node;\n    }\n    assignUiLayer(contentNode);\n\n    const rootTransform = this.node.getComponent(UITransform) ?? this.node.addComponent(UITransform);\n    const contentTransform = contentNode.getComponent(UITransform) ?? contentNode.addComponent(UITransform);\n    contentTransform.setContentSize(Math.max(120, rootTransform.width - 24), Math.max(80, rootTransform.height - 24));\n    contentNode.setPosition(0, 0, 0.5);\n\n    if (this.label) {\n      return this.label;\n    }\n\n    const label = contentNode.getComponent(Label) ?? contentNode.addComponent(Label);\n    label.fontSize = 16;\n    label.lineHeight = 20;\n    label.horizontalAlign = H_ALIGN_LEFT;\n    label.verticalAlign = V_ALIGN_TOP;\n    label.overflow = OVERFLOW_RESIZE_HEIGHT;\n    label.enableWrapText = true;\n    this.label = label;\n    return label;\n  }\n}\n`;

const testTemplate = `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { build${panelName}PanelViewModel } from "../assets/scripts/cocos-${kebabName}-panel-model.ts";\n\ntest("build${panelName}PanelViewModel keeps the title in the header and forwards detail lines", () => {\n  const view = build${panelName}PanelViewModel({\n    title: "测试标题",\n    detailLines: ["第一行", "第二行"],\n  });\n\n  assert.deepEqual(view.headerLines, ["测试标题"]);\n  assert.deepEqual(view.detailLines, ["第一行", "第二行"]);\n});\n`;

const outputs = [
  { file: modelFile, content: modelTemplate },
  { file: panelFile, content: panelTemplate },
  { file: testFile, content: testTemplate },
];

for (const output of outputs) {
  if (fs.existsSync(output.file)) {
    console.error(`Refusing to overwrite existing file: ${path.relative(process.cwd(), output.file)}`);
    process.exit(1);
  }
}

for (const output of outputs) {
  fs.writeFileSync(output.file, output.content, "utf8");
  console.log(`created ${path.relative(process.cwd(), output.file)}`);
}
