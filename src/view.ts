import { ItemView, Platform, setIcon } from "obsidian";
import type { TFile, WorkspaceLeaf } from "obsidian";
import type DayTimelinePlugin from "./main";
import { collectEntries, groupDays } from "./data";
import type { DiaryDay, DiaryEntry, DiaryImage } from "./data";
import {
  WEEKDAYS_SHORT,
  debounce,
  el,
  empty,
  friendlyDayLabel,
  fullDateLabel,
  iconButton,
  isSameMonthDay,
  pad2,
  toDateKey,
} from "./utils";

export const VIEW_TYPE_TIMELINE = "day-timeline-view";
export type ViewMode = "timeline" | "calendar" | "onthisday";

export class TimelineView extends ItemView {
  private plugin: DayTimelinePlugin;
  private entries: DiaryEntry[] = [];
  private filteredDays: DiaryDay[] = [];
  private monthCounts = new Map<string, number>();
  private renderedCount = 0;
  private mode: ViewMode = "timeline";
  private query = "";
  private yearFilter = "";
  private calendarMonth: Date;
  private pendingDate = "";
  private loading = false;

  private scrollEl!: HTMLElement;
  private listEl!: HTMLElement;
  private searchBar!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private statsEl!: HTMLElement;
  private filterBar!: HTMLElement;
  private bannerEl!: HTMLElement;
  private calendarButton!: HTMLButtonElement;
  private memoryButton!: HTMLButtonElement;
  private sortButton!: HTMLButtonElement;

  private readonly scheduleReload: () => void;
  private readonly scheduleSearch: () => void;

  constructor(leaf: WorkspaceLeaf, plugin: DayTimelinePlugin) {
    super(leaf);
    this.plugin = plugin;
    const now = new Date();
    this.calendarMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    this.scheduleReload = debounce(() => void this.reload(), 400);
    this.scheduleSearch = debounce(() => {
      this.query = this.searchInput.value.trim();
      this.render();
    }, 220);
  }

  getViewType(): string {
    return VIEW_TYPE_TIMELINE;
  }

  getDisplayText(): string {
    return "日记时间线";
  }

  getIcon(): string {
    return "calendar";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    empty(root);
    root.classList.add("lt-root");

    root.appendChild(this.buildHeader());

    this.scrollEl = el("div", "lt-scroll");
    this.scrollEl.addEventListener("scroll", this.handleScroll, { passive: true });
    root.appendChild(this.scrollEl);
    this.listEl = el("div", "lt-content");
    this.scrollEl.appendChild(this.listEl);

    root.appendChild(
      iconButton("lt-fab", "plus", "写今天的日记", () => void this.plugin.createDiary(new Date())),
    );

    await this.reload();
  }

  async onClose(): Promise<void> {
    this.scrollEl?.removeEventListener("scroll", this.handleScroll);
  }

  /** 由插件在仓库变化或设置变化时调用（带防抖）。 */
  refresh(): void {
    this.scheduleReload();
  }

  /** 随机按钮的抽取范围：优先当前筛选结果（那年今天 / 搜索 / 年份），否则全部日记。 */
  private randomPool(): DiaryEntry[] {
    if (this.mode === "calendar") return this.entries;
    const pool: DiaryEntry[] = [];
    for (const day of this.filteredDays) pool.push(...day.entries);
    return pool.length > 0 ? pool : this.entries;
  }

  setMode(mode: ViewMode): void {
    this.mode = mode;
    this.query = "";
    this.yearFilter = "";
    this.pendingDate = "";
    if (this.searchInput) this.searchInput.value = "";
    this.searchBar?.classList.add("is-hidden");
    this.updateModeButtons();
    this.render();
    this.scrollEl?.scrollTo({ top: 0 });
  }

  private get pageSize(): number {
    const configured = this.plugin.settings.pageSize;
    return Platform.isMobile ? Math.min(configured, 20) : configured;
  }

  private handleScroll = (): void => {
    if (this.mode === "calendar" || this.loading) return;
    const node = this.scrollEl;
    if (!node) return;
    if (node.scrollTop + node.clientHeight >= node.scrollHeight - 480) this.loadMore();
  };

  // ---------------------------------------------------------------- 顶栏

  private buildHeader(): HTMLElement {
    const header = el("header", "lt-header");

    const titlebar = el("div", "lt-titlebar");
    const brand = el("div", "lt-brand");
    const logo = el("span", "lt-logo");
    setIcon(logo, "calendar-days");
    brand.appendChild(logo);
    const titles = el("div", "lt-titles");
    titles.appendChild(el("div", "lt-title", "时光轴"));
    this.statsEl = el("div", "lt-stats", "正在整理日记…");
    titles.appendChild(this.statsEl);
    brand.appendChild(titles);
    titlebar.appendChild(brand);

    const actions = el("div", "lt-actions");
    actions.appendChild(iconButton("lt-btn", "search", "搜索日记", () => this.toggleSearch()));
    this.calendarButton = iconButton("lt-btn", "calendar-days", "日历视图", () =>
      this.setMode(this.mode === "calendar" ? "timeline" : "calendar"),
    );
    this.memoryButton = iconButton("lt-btn", "history", "那年今天", () =>
      this.setMode(this.mode === "onthisday" ? "timeline" : "onthisday"),
    );
    actions.appendChild(this.calendarButton);
    actions.appendChild(this.memoryButton);
    actions.appendChild(
      iconButton("lt-btn", "shuffle", "随机打开一篇日记", () =>
        void this.plugin.openRandomDiary(this.randomPool()),
      ),
    );
    this.sortButton = this.textButton("", () => void this.toggleSort(), "lt-btn lt-sort-btn");
    actions.appendChild(this.sortButton);
    actions.appendChild(iconButton("lt-btn", "refresh-cw", "重新读取日记", () => void this.reload(true)));
    actions.appendChild(iconButton("lt-btn", "settings", "插件设置", () => this.plugin.openSettings()));
    titlebar.appendChild(actions);
    header.appendChild(titlebar);

    this.searchBar = el("div", "lt-searchbar is-hidden");
    this.searchInput = el("input", "lt-search-input");
    this.searchInput.type = "search";
    this.searchInput.placeholder = "搜索标题、正文、标签…";
    this.searchInput.addEventListener("input", this.scheduleSearch);
    this.searchBar.appendChild(this.searchInput);
    this.searchBar.appendChild(
      iconButton("lt-btn lt-search-clear", "x", "清除搜索", () => {
        this.searchInput.value = "";
        this.query = "";
        this.render();
      }),
    );
    header.appendChild(this.searchBar);

    this.filterBar = el("div", "lt-filterbar");
    header.appendChild(this.filterBar);
    this.bannerEl = el("div", "lt-banner is-hidden");
    header.appendChild(this.bannerEl);

    this.updateModeButtons();
    return header;
  }

  private textButton(label: string, onClick: () => void, className = ""): HTMLButtonElement {
    const button = el("button", `lt-link-btn ${className}`.trim(), label);
    button.type = "button";
    button.addEventListener("click", onClick);
    return button;
  }

  private updateModeButtons(): void {
    if (!this.calendarButton) return;
    this.calendarButton.classList.toggle("is-active", this.mode === "calendar");
    this.memoryButton.classList.toggle("is-active", this.mode === "onthisday");
    this.sortButton.textContent = this.plugin.settings.sortOrder === "desc" ? "倒序" : "正序";
    this.sortButton.title = "切换时间线排序方向";
  }

  private toggleSearch(): void {
    const nowHidden = this.searchBar.classList.toggle("is-hidden");
    if (nowHidden) {
      this.searchInput.value = "";
      this.query = "";
      this.render();
    } else {
      this.searchInput.focus();
    }
  }

  private async toggleSort(): Promise<void> {
    this.plugin.settings.sortOrder = this.plugin.settings.sortOrder === "desc" ? "asc" : "desc";
    await this.plugin.saveSettings();
    this.updateModeButtons();
    this.render();
    this.scrollEl.scrollTo({ top: 0 });
  }

  // ---------------------------------------------------------------- 数据

  private async reload(showNotice = false): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    if (this.statsEl) this.statsEl.textContent = "正在整理日记…";
    try {
      this.entries = await collectEntries(this.app, this.plugin.settings);
    } catch (error) {
      console.error("[Day Timeline] 读取日记失败", error);
      this.entries = [];
    }
    this.loading = false;
    this.render();
    if (showNotice) {
      const days = new Set(this.entries.map((entry) => entry.dateKey)).size;
      this.flash(`已读取 ${days} 天 · ${this.entries.length} 篇日记`);
    }
  }

  private flash(message: string): void {
    const toast = el("div", "lt-toast", message);
    this.contentEl.appendChild(toast);
    window.setTimeout(() => toast.remove(), 2200);
  }

  private computeDays(): DiaryDay[] {
    let entries = this.entries;
    const today = new Date();

    if (this.mode === "onthisday") {
      entries = entries.filter(
        (entry) => isSameMonthDay(entry.date, today) && entry.date.getFullYear() !== today.getFullYear(),
      );
    }
    if (this.yearFilter) {
      entries = entries.filter((entry) => String(entry.date.getFullYear()) === this.yearFilter);
    }
    if (this.query) {
      const needle = this.query.toLowerCase();
      entries = entries.filter(
        (entry) =>
          entry.title.toLowerCase().includes(needle) ||
          entry.excerpt.toLowerCase().includes(needle) ||
          entry.file.path.toLowerCase().includes(needle) ||
          entry.tags.some((tag) => tag.toLowerCase().includes(needle)),
      );
    }
    return groupDays(entries, this.plugin.settings.sortOrder);
  }

  private render(): void {
    if (!this.listEl) return;
    this.updateModeButtons();
    if (this.mode === "calendar") {
      this.renderCalendar();
      return;
    }

    empty(this.listEl);
    this.renderedCount = 0;
    this.filteredDays = this.computeDays();
    this.monthCounts = this.countMonths(this.filteredDays);
    this.renderFilterBar();
    this.renderBanner();
    this.updateStats();

    if (this.filteredDays.length === 0) {
      this.listEl.appendChild(this.buildEmptyState());
      return;
    }
    this.loadMore();
    if (this.pendingDate) this.scrollToDate(this.pendingDate);
  }

  private countMonths(days: DiaryDay[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const day of days) {
      const key = `${day.date.getFullYear()}-${pad2(day.date.getMonth() + 1)}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }

  private updateStats(): void {
    if (!this.statsEl) return;
    const days = new Set(this.entries.map((entry) => entry.dateKey)).size;
    this.statsEl.textContent = this.entries.length === 0
      ? "还没有找到日记"
      : `${days} 天 · ${this.entries.length} 篇日记`;
  }

  private renderFilterBar(): void {
    empty(this.filterBar);
    const years = Array.from(new Set(this.entries.map((entry) => String(entry.date.getFullYear())))).sort((a, b) =>
      b.localeCompare(a),
    );
    if (years.length < 2) {
      this.filterBar.classList.add("is-hidden");
      return;
    }
    this.filterBar.classList.remove("is-hidden");
    this.filterBar.appendChild(
      this.chip("全部", this.yearFilter === "", () => {
        this.yearFilter = "";
        this.render();
      }),
    );
    for (const year of years) {
      this.filterBar.appendChild(
        this.chip(`${year} 年`, this.yearFilter === year, () => {
          this.yearFilter = this.yearFilter === year ? "" : year;
          this.render();
        }),
      );
    }
  }

  private chip(label: string, active: boolean, onClick: () => void): HTMLElement {
    const chip = el("button", `lt-chip${active ? " is-active" : ""}`, label);
    chip.type = "button";
    chip.addEventListener("click", onClick);
    return chip;
  }

  private renderBanner(): void {
    empty(this.bannerEl);
    const parts: string[] = [];
    if (this.mode === "onthisday") parts.push(`那年今天 · ${new Date().getMonth() + 1}月${new Date().getDate()}日`);
    if (this.yearFilter) parts.push(`${this.yearFilter} 年`);
    if (this.query) parts.push(`搜索「${this.query}」`);
    if (parts.length === 0) {
      this.bannerEl.classList.add("is-hidden");
      return;
    }
    this.bannerEl.classList.remove("is-hidden");
    this.bannerEl.appendChild(el("span", "lt-banner-text", `${parts.join(" · ")} · 共 ${this.filteredDays.length} 天`));
    this.bannerEl.appendChild(
      this.textButton("返回完整时间线", () => {
        this.mode = "timeline";
        this.query = "";
        this.yearFilter = "";
        this.searchInput.value = "";
        this.searchBar.classList.add("is-hidden");
        this.render();
      }),
    );
  }

  // ---------------------------------------------------------------- 时间线

  private loadMore(): void {
    const days = this.filteredDays;
    if (this.renderedCount >= days.length) return;

    const settings = this.plugin.settings;
    const next = days.slice(this.renderedCount, this.renderedCount + this.pageSize);
    let lastMonth = this.renderedCount > 0 ? this.monthKey(days[this.renderedCount - 1].date) : "";
    const fragment = document.createDocumentFragment();

    for (const day of next) {
      const key = this.monthKey(day.date);
      if (settings.groupByMonth && key !== lastMonth) {
        fragment.appendChild(this.buildMonthDivider(day.date, key));
        lastMonth = key;
      }
      fragment.appendChild(this.buildDayNode(day));
    }

    const oldFooter = this.listEl.querySelector(".lt-list-footer");
    if (oldFooter) oldFooter.remove();
    this.listEl.appendChild(fragment);
    this.renderedCount += next.length;

    const footer = el("div", "lt-list-footer");
    if (this.renderedCount < days.length) {
      const more = el("button", "lt-more-btn", "继续往下看");
      more.type = "button";
      more.addEventListener("click", () => this.loadMore());
      footer.appendChild(more);
      footer.appendChild(el("div", "lt-footer-hint", `已显示 ${this.renderedCount} / ${days.length} 天`));
    } else {
      footer.appendChild(el("div", "lt-footer-hint", `· 已经到底了 · 共 ${days.length} 天`));
    }
    this.listEl.appendChild(footer);
  }

  private monthKey(date: Date): string {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
  }

  private buildMonthDivider(date: Date, key: string): HTMLElement {
    const divider = el("div", "lt-month");
    divider.appendChild(el("span", "lt-month-year", String(date.getFullYear())));
    divider.appendChild(el("span", "lt-month-name", `${date.getMonth() + 1} 月`));
    divider.appendChild(el("span", "lt-month-count", `${this.monthCounts.get(key) ?? 0} 天`));
    return divider;
  }

  private buildDayNode(day: DiaryDay): HTMLElement {
    const todayKey = toDateKey(new Date());
    const isToday = day.dateKey === todayKey;
    const wrap = el("section", `lt-day${isToday ? " is-today" : ""}`);
    wrap.dataset.date = day.dateKey;

    const rail = el("div", "lt-rail");
    if (this.mode === "onthisday" || this.query) {
      rail.appendChild(el("div", "lt-rail-year", String(day.date.getFullYear())));
    }
    rail.appendChild(el("div", "lt-rail-month", `${day.date.getMonth() + 1}月`));
    rail.appendChild(el("div", "lt-rail-day", pad2(day.date.getDate())));
    rail.appendChild(el("div", "lt-rail-week", WEEKDAYS_SHORT[day.date.getDay()]));
    wrap.appendChild(rail);

    const axis = el("div", "lt-axis");
    axis.appendChild(el("span", "lt-dot"));
    wrap.appendChild(axis);

    const card = el("div", "lt-card");
    const head = el("div", "lt-card-head");
    const heading = el("div", "lt-card-heading");
    heading.appendChild(el("span", "lt-card-date", fullDateLabel(day.date)));
    heading.appendChild(el("span", "lt-badge", friendlyDayLabel(day.date)));
    if (this.mode === "onthisday") {
      heading.appendChild(el("span", "lt-badge is-year", `${day.date.getFullYear()} 年`));
    }
    head.appendChild(heading);
    head.appendChild(el("div", "lt-card-meta", `${day.entries.length} 篇 · ${day.charCount} 字`));
    head.addEventListener("click", () => void this.openFile(day.entries[0].file));
    card.appendChild(head);

    const body = el("div", "lt-card-body");
    const visible = day.entries.slice(0, 3);
    for (const entry of visible) body.appendChild(this.buildEntryNode(entry));
    if (day.entries.length > visible.length) {
      const more = this.textButton(`展开这一天的另外 ${day.entries.length - visible.length} 篇`, () => {
        empty(body);
        for (const entry of day.entries) body.appendChild(this.buildEntryNode(entry));
      }, "lt-expand");
      body.appendChild(more);
    }
    card.appendChild(body);

    if (this.plugin.settings.showImages && day.images.length > 0) {
      card.appendChild(this.buildImages(day.images, day.entries[0].file));
    }
    if (this.plugin.settings.showTags && day.tags.length > 0) {
      const tags = el("div", "lt-tags");
      for (const tag of day.tags.slice(0, 6)) tags.appendChild(el("span", "lt-tag", `#${tag}`));
      card.appendChild(tags);
    }

    const actions = el("div", "lt-card-actions");
    actions.appendChild(this.textButton("打开日记", () => void this.openFile(day.entries[0].file), "lt-open-btn"));
    card.appendChild(actions);

    wrap.appendChild(card);
    return wrap;
  }

  private buildEntryNode(entry: DiaryEntry): HTMLElement {
    const node = el("div", "lt-entry");
    node.setAttribute("role", "button");
    node.tabIndex = 0;
    node.appendChild(el("div", "lt-entry-title", entry.title));
    if (entry.excerpt) node.appendChild(el("div", "lt-entry-excerpt", entry.excerpt));
    else node.appendChild(el("div", "lt-entry-excerpt is-empty", "（这一天只留下了图片或空白）"));
    const open = () => void this.openFile(entry.file);
    node.addEventListener("click", open);
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
    return node;
  }

  private buildImages(images: DiaryImage[], file: TFile): HTMLElement {
    const max = this.plugin.settings.maxImagesPerDay;
    const grid = el("div", `lt-images${images.length === 1 ? " is-single" : ""}`);
    for (const image of images.slice(0, max)) {
      const box = el("div", "lt-image");
      const img = el("img");
      img.src = image.url;
      img.alt = image.alt;
      img.loading = "lazy";
      img.addEventListener("click", () => void this.openFile(file));
      box.appendChild(img);
      grid.appendChild(box);
    }
    if (images.length > max) {
      const more = el("div", "lt-image-more");
      more.textContent = `+${images.length - max}`;
      more.addEventListener("click", () => void this.openFile(file));
      grid.appendChild(more);
    }
    return grid;
  }

  private buildEmptyState(): HTMLElement {
    const box = el("div", "lt-empty");
    const icon = el("div", "lt-empty-icon");
    setIcon(icon, "book-open");
    box.appendChild(icon);
    const searching = Boolean(this.query || this.yearFilter);
    const title = this.mode === "onthisday"
      ? "往年的今天还没有记录"
      : searching
        ? "没有找到匹配的日记"
        : "时间线还是空的";
    box.appendChild(el("div", "lt-empty-title", title));
    box.appendChild(
      el(
        "div",
        "lt-empty-desc",
        searching
          ? "换个关键词，或在插件设置里检查日记文件夹与日期格式。"
          : "把日记放进设定的文件夹，文件名带上日期（如 2026-11-07），就会自动排进时间线。",
      ),
    );
    box.appendChild(this.textButton("写一篇今天的日记", () => void this.plugin.createDiary(new Date()), "lt-primary-btn"));
    return box;
  }

  private async openFile(file: TFile): Promise<void> {
    await this.app.workspace.getLeaf(true).openFile(file);
  }

  private scrollToDate(key: string): void {
    const index = this.filteredDays.findIndex((day) => day.dateKey === key);
    if (index >= 0) {
      let guard = 0;
      while (this.renderedCount <= index && guard < 200) {
        this.loadMore();
        guard += 1;
      }
      const target = this.listEl.querySelector<HTMLElement>(`.lt-day[data-date="${key}"]`);
      if (target) {
        const top = target.getBoundingClientRect().top - this.scrollEl.getBoundingClientRect().top + this.scrollEl.scrollTop - 16;
        this.scrollEl.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
        target.classList.add("is-highlight");
        window.setTimeout(() => target.classList.remove("is-highlight"), 2000);
      }
    }
    this.pendingDate = "";
  }

  // ---------------------------------------------------------------- 日历

  private renderCalendar(): void {
    empty(this.listEl);
    this.filterBar.classList.add("is-hidden");
    this.bannerEl.classList.add("is-hidden");
    this.updateStats();

    const year = this.calendarMonth.getFullYear();
    const month = this.calendarMonth.getMonth();
    const dayMap = new Map<string, DiaryDay>(groupDays(this.entries, "asc").map((day) => [day.dateKey, day]));

    const calendar = el("div", "lt-calendar");
    const bar = el("div", "lt-cal-bar");
    bar.appendChild(iconButton("lt-btn", "chevron-left", "上一个月", () => this.shiftMonth(-1)));
    bar.appendChild(el("div", "lt-cal-title", `${year} 年 ${month + 1} 月`));
    bar.appendChild(iconButton("lt-btn", "chevron-right", "下一个月", () => this.shiftMonth(1)));
    bar.appendChild(this.textButton("回到本月", () => {
      const now = new Date();
      this.calendarMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      this.renderCalendar();
    }, "lt-cal-today"));
    calendar.appendChild(bar);

    const weekRow = el("div", "lt-cal-week");
    for (const label of ["一", "二", "三", "四", "五", "六", "日"]) {
      weekRow.appendChild(el("div", "lt-cal-weekday", label));
    }
    calendar.appendChild(weekRow);

    const grid = el("div", "lt-cal-grid");
    const offset = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cellCount = Math.ceil((offset + daysInMonth) / 7) * 7;
    const todayKey = toDateKey(new Date());

    for (let index = 0; index < cellCount; index += 1) {
      const date = new Date(year, month, index - offset + 1);
      const key = toDateKey(date);
      const day = dayMap.get(key);
      const outside = date.getMonth() !== month;
      const cell = el("div", `lt-cal-cell${outside ? " is-outside" : ""}${day ? " has-note" : ""}${key === todayKey ? " is-today" : ""}`);
      cell.appendChild(el("div", "lt-cal-num", String(date.getDate())));

      if (day) {
        const firstImage = day.images[0];
        if (firstImage) {
          const thumb = el("img", "lt-cal-thumb");
          thumb.src = firstImage.url;
          thumb.alt = "";
          thumb.loading = "lazy";
          cell.appendChild(thumb);
        }
        const dots = el("div", "lt-cal-dots");
        for (let i = 0; i < Math.min(day.entries.length, 3); i += 1) dots.appendChild(el("span", "lt-cal-dot"));
        cell.appendChild(dots);
      }

      cell.title = day ? `${key} · ${day.entries.length} 篇日记` : `${key} · 点击新建日记`;
      cell.addEventListener("click", () => {
        if (day) {
          this.mode = "timeline";
          this.pendingDate = key;
          this.updateModeButtons();
          this.render();
        } else {
          void this.plugin.createDiary(date);
        }
      });
      grid.appendChild(cell);
    }
    calendar.appendChild(grid);

    const legend = el("div", "lt-cal-legend", "有圆点的日子写过日记 · 点空白日期可以新建这一天的日记");
    calendar.appendChild(legend);
    this.listEl.appendChild(calendar);
  }

  private shiftMonth(delta: number): void {
    this.calendarMonth = new Date(this.calendarMonth.getFullYear(), this.calendarMonth.getMonth() + delta, 1);
    this.renderCalendar();
  }
}
