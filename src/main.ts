import { Notice, Plugin, TFile } from "obsidian";
import type { ViewMode } from "./view";
import { TimelineView, VIEW_TYPE_TIMELINE } from "./view";
import { DEFAULT_SETTINGS, TimelineSettingTab } from "./settings";
import type { TimelineSettings } from "./settings";
import { collectEntries, diaryPathFor, findDiariesForDate } from "./data";
import type { DiaryEntry } from "./data";
import { debounce, renderNoteTemplate, toDateKey } from "./utils";

export default class DayTimelinePlugin extends Plugin {
  settings: TimelineSettings = { ...DEFAULT_SETTINGS };

  private readonly delayedRefresh = debounce(() => this.refreshViews(), 1500);

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_TIMELINE, (leaf) => new TimelineView(leaf, this));

    this.addRibbonIcon("calendar", "打开日记时间线", () => void this.activateView());

    this.addCommand({
      id: "open-day-timeline",
      name: "打开日记时间线",
      callback: () => void this.activateView(),
    });
    this.addCommand({
      id: "open-day-timeline-calendar",
      name: "打开日记日历",
      callback: () => void this.activateView("calendar"),
    });
    this.addCommand({
      id: "day-timeline-on-this-day",
      name: "那年今天",
      callback: () => void this.activateView("onthisday"),
    });
    this.addCommand({
      id: "day-timeline-write-today",
      name: "写今天的日记",
      callback: () => void this.createDiary(new Date()),
    });
    this.addCommand({
      id: "day-timeline-random-diary",
      name: "随机打开一篇日记",
      callback: () => void this.openRandomDiary(),
    });

    this.addSettingTab(new TimelineSettingTab(this.app, this));

    const immediate = () => this.refreshViews();
    this.registerEvent(this.app.vault.on("create", immediate));
    this.registerEvent(this.app.vault.on("delete", immediate));
    this.registerEvent(this.app.vault.on("rename", immediate));
    // 编辑时避免每次敲字都重扫整个仓库
    this.registerEvent(this.app.vault.on("modify", () => this.delayedRefresh()));
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<TimelineSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE)) {
      if (leaf.view instanceof TimelineView) leaf.view.refresh();
    }
  }

  /** 随机打开一篇日记。传入 entries 时按视图当前筛选结果抽取，否则扫描全库。 */
  async openRandomDiary(entries?: DiaryEntry[]): Promise<void> {
    let pool = entries;
    if (!pool || pool.length === 0) {
      try {
        pool = await collectEntries(this.app, this.settings);
      } catch (error) {
        console.error("[Day Timeline] 随机日记读取失败", error);
        new Notice("日记时间线：读取日记失败");
        return;
      }
    }
    if (!pool.length) {
      new Notice("日记时间线：还没有找到日记");
      return;
    }
    const picked = pool[Math.floor(Math.random() * pool.length)];
    try {
      await this.app.workspace.getLeaf(true).openFile(picked.file);
      new Notice(`随机日记 · ${picked.dateKey} · ${picked.title}`);
    } catch (error) {
      console.error("[Day Timeline] 随机日记打开失败", error);
      new Notice("日记时间线：打开日记失败");
    }
  }

  /**
   * 打开本插件的设置页。Obsidian 没有提供公开 API，这里做多级回退，
   * 避免内部 API 变化或移动端差异导致点击后毫无反应。
   */
  openSettings(): void {
    type SettingManager = {
      open?: () => void;
      openTabById?: (id: string) => void;
      openTab?: (tab: unknown) => void;
      settingTabs?: Array<{ id?: string }>;
    };
    const app = this.app as unknown as {
      setting?: SettingManager;
      commands?: { executeCommandById?: (id: string) => boolean };
    };
    const setting = app.setting;
    let windowOpened = false;

    try {
      // 关键：必须先打开设置窗口；openTabById 只负责切换到指定标签页
      if (setting?.open) {
        setting.open();
        windowOpened = true;
      }
      if (setting?.openTabById) {
        setting.openTabById(this.manifest.id);
      } else if (setting?.openTab && Array.isArray(setting.settingTabs)) {
        const tab = setting.settingTabs.find((item) => item.id === this.manifest.id);
        if (tab) setting.openTab(tab);
      }
    } catch (error) {
      console.error("[Day Timeline] 打开插件设置失败", error);
    }

    // 兜底：内部 API 不可用时至少把设置窗口打开
    if (!windowOpened) {
      try {
        const executed = app.commands?.executeCommandById?.("app:open-settings");
        if (!executed) new Notice("请在「设置 → 第三方插件」中找到「日记时间线 Day Timeline」");
      } catch (error) {
        console.error("[Day Timeline] 打开设置窗口失败", error);
        new Notice("请在「设置 → 第三方插件」中找到「日记时间线 Day Timeline」");
      }
    }
  }

  async activateView(mode: ViewMode = "timeline"): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TIMELINE);
    let view: TimelineView | null = null;

    if (existing.length > 0) {
      await this.app.workspace.revealLeaf(existing[0]);
      if (existing[0].view instanceof TimelineView) view = existing[0].view;
    } else {
      const leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_TIMELINE, active: true });
      if (leaf.view instanceof TimelineView) view = leaf.view;
    }
    if (view && mode !== "timeline") view.setMode(mode);
  }

  /** 当天已有日记则直接打开；确实没有时才按配置的日期格式新建。 */
  async createDiary(date: Date): Promise<void> {
    const path = diaryPathFor(this.app, this.settings, date);
    const atPath = this.app.vault.getAbstractFileByPath(path);
    let file: TFile | null = atPath instanceof TFile ? atPath : null;

    if (!file) {
      // 标准路径不存在不等于当天没写过：文件名带后缀、换了日期格式、
      // 或日期写在 frontmatter 里的日记，都要按时间线的规则再找一次。
      const existing = findDiariesForDate(this.app, this.settings, date);
      if (existing.length > 0) {
        file = existing[0];
        new Notice(
          existing.length > 1
            ? `${toDateKey(date)} 已有 ${existing.length} 篇日记，已打开最近编辑的一篇`
            : `已打开当天日记 ${file.basename}`,
        );
      }
    }

    if (!file) {
      await this.ensureParentFolder(path);
      const content = renderNoteTemplate(this.settings.noteTemplate, date);
      try {
        file = await this.app.vault.create(path, content);
        new Notice(`已创建日记 ${path}`);
      } catch (error) {
        console.error("[Day Timeline] 创建日记失败", error);
        new Notice("创建日记失败，请检查插件设置里的文件夹与日期格式");
        return;
      }
    }
    await this.app.workspace.getLeaf(true).openFile(file);
  }

  private async ensureParentFolder(path: string): Promise<void> {
    const parts = path.split("/");
    parts.pop();
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        try {
          await this.app.vault.createFolder(current);
        } catch {
          // 另一个进程刚好创建了同名目录，忽略即可
        }
      }
    }
  }
}
