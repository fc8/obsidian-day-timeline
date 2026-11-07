import { App, PluginSettingTab, Setting } from "obsidian";
import type DayTimelinePlugin from "./main";
import { el, empty, resolveDailyNotesOptions } from "./utils";

export interface TimelineSettings {
  /** 跟随核心插件「日记」的文件夹与日期格式 */
  followDailyNotes: boolean;
  /** 日记所在文件夹，留空表示整个仓库 */
  noteFolder: string;
  /** 新建日记的文件名格式 */
  dateFormat: string;
  /** frontmatter 中作为日期的字段，逗号分隔，按优先级 */
  dateField: string;
  /** 排除的文件夹，逗号分隔 */
  excludeFolders: string;
  /** 文件名没有日期时，回退用文件创建日期 */
  fallbackToFileDate: boolean;
  sortOrder: "desc" | "asc";
  excerptLength: number;
  showImages: boolean;
  maxImagesPerDay: number;
  showTags: boolean;
  groupByMonth: boolean;
  pageSize: number;
  /** 新建日记的默认内容，支持 {{date}} / {{date:YYYY年M月D日}} / \n */
  noteTemplate: string;
}

export const DEFAULT_SETTINGS: TimelineSettings = {
  followDailyNotes: true,
  noteFolder: "",
  dateFormat: "YYYY-MM-DD",
  dateField: "date, created, 日期",
  excludeFolders: "templates, Templates, 模板, _templates",
  fallbackToFileDate: false,
  sortOrder: "desc",
  excerptLength: 180,
  showImages: true,
  maxImagesPerDay: 4,
  showTags: true,
  groupByMonth: true,
  pageSize: 30,
  noteTemplate: "",
};

export class TimelineSettingTab extends PluginSettingTab {
  plugin: DayTimelinePlugin;

  constructor(app: App, plugin: DayTimelinePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private heading(text: string): void {
    const heading = el("h3", "lt-setting-heading", text);
    this.containerEl.appendChild(heading);
  }

  private async savePatch(patch: Partial<TimelineSettings>, redraw = false): Promise<void> {
    Object.assign(this.plugin.settings, patch);
    await this.plugin.saveSettings();
    this.plugin.refreshViews();
    if (redraw) this.display();
  }

  display(): void {
    const { containerEl } = this;
    empty(containerEl);
    const s = this.plugin.settings;

    const intro = el("div", "lt-setting-intro");
    intro.appendChild(el("div", "lt-setting-intro-title", "日记时间线"));
    intro.appendChild(
      el(
        "div",
        "lt-setting-intro-desc",
        "把日记按天排成一条时间线。所有数据只读取本地仓库，桌面端与手机端通用。",
      ),
    );
    containerEl.appendChild(intro);

    this.heading("日记来源");

    new Setting(containerEl)
      .setName("跟随 Obsidian「日记」设置")
      .setDesc("自动使用核心插件「日记」里的文件夹与日期格式；关闭后使用下面的自定义值。")
      .addToggle((toggle) =>
        toggle.setValue(s.followDailyNotes).onChange(async (value) => {
          await this.savePatch({ followDailyNotes: value }, true);
        }),
      );

    const daily = resolveDailyNotesOptions(this.app);
    const detected = daily.folder || daily.format
      ? `当前检测到：文件夹 ${daily.folder || "仓库根目录"}，格式 ${daily.format || "YYYY-MM-DD"}`
      : "未检测到已配置的「日记」核心插件，将使用自定义值。";

    new Setting(containerEl).setName("日记文件夹").setDesc(detected).addText((text) =>
      text
        .setPlaceholder("例如：日记 / Daily Notes（留空为整个仓库）")
        .setValue(s.noteFolder)
        .onChange(async (value) => {
          await this.savePatch({ noteFolder: value });
        }),
    );

    new Setting(containerEl)
      .setName("文件名日期格式")
      .setDesc("用于新建日记，支持 YYYY MM DD M D dddd 等标记，例如 YYYY-MM-DD、YYYY年M月D日。")
      .addText((text) =>
        text.setValue(s.dateFormat).onChange(async (value) => {
          await this.savePatch({ dateFormat: value || "YYYY-MM-DD" });
        }),
      );

    new Setting(containerEl)
      .setName("日期字段（frontmatter）")
      .setDesc("优先从这些字段读取日期，逗号分隔。留空则只按文件名识别。")
      .addText((text) =>
        text.setPlaceholder("date, created, 日期").setValue(s.dateField).onChange(async (value) => {
          await this.savePatch({ dateField: value });
        }),
      );

    new Setting(containerEl)
      .setName("排除文件夹")
      .setDesc("这些文件夹里的笔记不进入时间线，逗号分隔。")
      .addText((text) =>
        text.setPlaceholder("templates, 模板").setValue(s.excludeFolders).onChange(async (value) => {
          await this.savePatch({ excludeFolders: value });
        }),
      );

    new Setting(containerEl)
      .setName("按文件创建日期兜底")
      .setDesc("开启后，文件名和 frontmatter 都没有日期的笔记会按文件创建时间进入时间线。若日记文件夹里混有其他笔记，建议关闭。")
      .addToggle((toggle) =>
        toggle.setValue(s.fallbackToFileDate).onChange(async (value) => {
          await this.savePatch({ fallbackToFileDate: value });
        }),
      );

    this.heading("时间线外观");

    new Setting(containerEl)
      .setName("排序方向")
      .setDesc("倒序：最新的一天在最上面（与「人生笔记」一致）。")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("desc", "倒序 · 由近及远")
          .addOption("asc", "正序 · 由远及近")
          .setValue(s.sortOrder)
          .onChange(async (value) => {
            await this.savePatch({ sortOrder: value as "desc" | "asc" });
          }),
      );

    new Setting(containerEl).setName("按月份分组").addToggle((toggle) =>
      toggle.setValue(s.groupByMonth).onChange(async (value) => {
        await this.savePatch({ groupByMonth: value });
      }),
    );

    new Setting(containerEl).setName("显示图片").setDesc("读取 ![[图片]] 与 ![](图片)，在每天卡片里生成缩略图网格。").addToggle((toggle) =>
      toggle.setValue(s.showImages).onChange(async (value) => {
        await this.savePatch({ showImages: value }, true);
      }),
    );

    if (s.showImages) {
      new Setting(containerEl).setName("每天最多显示图片").addSlider((slider) =>
        slider
          .setLimits(1, 9, 1)
          .setValue(s.maxImagesPerDay)
          .setDynamicTooltip()
          .onChange(async (value) => {
            await this.savePatch({ maxImagesPerDay: value });
          }),
      );
    }

    new Setting(containerEl).setName("显示标签").addToggle((toggle) =>
      toggle.setValue(s.showTags).onChange(async (value) => {
        await this.savePatch({ showTags: value });
      }),
    );

    new Setting(containerEl).setName("摘要字数").addSlider((slider) =>
      slider
        .setLimits(40, 400, 20)
        .setValue(s.excerptLength)
        .setDynamicTooltip()
        .onChange(async (value) => {
          await this.savePatch({ excerptLength: value });
        }),
    );

    new Setting(containerEl)
      .setName("每次加载天数")
      .setDesc("滚动到底部自动加载更多。数值小一点在手机上更省内存。")
      .addSlider((slider) =>
        slider
          .setLimits(10, 100, 10)
          .setValue(s.pageSize)
          .setDynamicTooltip()
          .onChange(async (value) => {
            await this.savePatch({ pageSize: value });
          }),
      );

    this.heading("写日记");

    new Setting(containerEl)
      .setName("新建日记默认内容")
      .setDesc("支持 {{date}}、{{date:YYYY年M月D日 dddd}}、\\n 换行。留空则创建空白日记。")
      .addTextArea((text) =>
        text
          .setPlaceholder("例如：## {{date:YYYY年M月D日 dddd}}\\n\\n")
          .setValue(s.noteTemplate)
          .onChange(async (value) => {
            await this.savePatch({ noteTemplate: value });
          }),
      );

    const tip = el(
      "div",
      "lt-setting-tip",
      "小提示：点击时间线右下角的「+」可以写今天；顶栏的随机按钮会从当前筛选结果里抽一篇日记；在日历视图里点一个空白日期，可以直接新建那一天。命令面板里还有「那年今天」和「随机打开一篇日记」。",
    );
    containerEl.appendChild(tip);
  }
}
