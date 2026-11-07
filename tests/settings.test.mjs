import esbuild from "esbuild";
import fs from "node:fs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const TMP = ".tmp-main.cjs";

// main.ts 会被完整 bundle，这里替掉 Obsidian 的运行时导出
const STUB = `
class Plugin { constructor(app, manifest) { this.app = app; this.manifest = manifest; } }
class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = {}; } }
class ItemView { constructor(leaf) { this.leaf = leaf; this.contentEl = {}; } }
class Setting { constructor(el) { this.el = el; } setName(){ return this; } setDesc(){ return this; } addText(){ return this; } addToggle(){ return this; } addSlider(){ return this; } addDropdown(){ return this; } }
class Notice { constructor(message) { globalThis.__ltNotices.push(String(message)); } }
class TFile {}
class App {}
exports.Plugin = Plugin;
exports.PluginSettingTab = PluginSettingTab;
exports.ItemView = ItemView;
exports.Setting = Setting;
exports.Notice = Notice;
exports.TFile = TFile;
exports.App = App;
exports.Platform = { isMobile: false, isDesktop: true };
exports.setIcon = function () {};
exports.normalizePath = function (p) { return String(p).split("/").filter(Boolean).join("/"); };
`;

await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: TMP,
  logLevel: "silent",
  plugins: [{
    name: "stub-obsidian",
    setup(build) {
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "stub" }));
      build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: STUB, loader: "js" }));
    },
  }],
});

globalThis.__ltNotices = [];
const DayTimelinePlugin = require("../" + TMP).default;
const makePlugin = (app) => new DayTimelinePlugin(app, { id: "day-timeline" });
const calls = [];

// 1. 正常路径：必须先打开设置窗口，再切到本插件标签页（旧实现缺了 open，导致点击无反应）
makePlugin({
  setting: {
    open: () => calls.push("open"),
    openTabById: (id) => calls.push("tab:" + id),
  },
}).openSettings();
assert.deepEqual(calls, ["open", "tab:day-timeline"]);

// 2. 没有 openTabById 时，从 settingTabs 找到本插件再 openTab
calls.length = 0;
makePlugin({
  setting: {
    open: () => calls.push("open"),
    openTab: (tab) => calls.push("openTab:" + tab.id),
    settingTabs: [{ id: "other" }, { id: "day-timeline" }],
  },
}).openSettings();
assert.deepEqual(calls, ["open", "openTab:day-timeline"]);

// 3. 完全没有 app.setting（移动端常见）时回退到内置命令
calls.length = 0;
makePlugin({
  commands: { executeCommandById: (id) => { calls.push("cmd:" + id); return true; } },
}).openSettings();
assert.deepEqual(calls, ["cmd:app:open-settings"]);

// 4. 内部 API 全部不可用时要给用户明确指引，而不是静默失败
globalThis.__ltNotices.length = 0;
makePlugin({}).openSettings();
assert.ok(globalThis.__ltNotices.some((m) => m.includes("第三方插件")), "应提示手动进入设置");

// 5. setting.open 抛异常时仍走兜底
calls.length = 0;
const originalError = console.error;
console.error = () => {};
makePlugin({
  setting: { open() { throw new Error("boom"); } },
  commands: { executeCommandById: (id) => { calls.push("cmd:" + id); return true; } },
}).openSettings();
console.error = originalError;
assert.deepEqual(calls, ["cmd:app:open-settings"]);

fs.rmSync(TMP, { force: true });
console.log("设置入口: 5 组场景通过（开窗顺序 / 标签定位 / 命令兜底 / 用户提示 / 异常兜底）");
