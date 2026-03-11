import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { App, ItemView, Notice, TFile, ViewStateResult, WorkspaceLeaf, setIcon } from 'obsidian';
import MyPlugin from './main';

const electron = require('electron');
const shell = electron.shell as {
	openExternal: (target: string) => Promise<void>;
	openPath: (target: string) => Promise<string>;
	showItemInFolder: (target: string) => void;
};

export const EAGLE_REFERENCE_VIEW_TYPE = 'eagle-reference-view';

const EAGLE_API_BASE_URL = 'http://localhost:41595/api/item';
const RELEVANT_FILE_EXTENSIONS = new Set(['md', 'canvas']);
const EAGLE_ITEM_INFO_URL_REGEX_SOURCE = 'http:\\/\\/localhost:\\d+\\/images\\/([^/?#\\s]+)\\.info';
const EAGLE_CANVAS_PROXY_URL_REGEX = /^http:\/\/localhost:\d+\/__eaglebridge__\/canvas-(?:image|resource)\?/i;

type EagleReferenceSourceType = 'markdown' | 'canvas';
type SearchScope = 'current' | 'all';

interface EagleLocalItemMetadata {
	name: string;
	ext: string;
	label: string;
}

interface EagleLiveItemInfo {
	id: string;
	name: string;
	ext: string;
	annotation: string;
	url: string;
	tags: string[];
}

interface EagleItemDraft {
	annotation: string;
	url: string;
	tags: string;
}

export interface EagleFileReference {
	file: TFile;
	filePath: string;
	fileName: string;
	sourceType: EagleReferenceSourceType;
	occurrenceCount: number;
}

export interface EagleItemReference {
	itemId: string;
	displayName: string;
	ext: string;
	referenceCount: number;
	mentionCount: number;
	references: EagleFileReference[];
}

export interface EagleReferenceSnapshot {
	items: EagleItemReference[];
	itemsById: Map<string, EagleItemReference>;
	fileToItemIds: Map<string, string[]>;
	scannedAt: number;
	scannedFileCount: number;
}

interface EagleReferenceViewState extends Record<string, unknown> {
	searchTerm?: string;
	searchScope?: SearchScope;
	selectedItemId?: string | null;
}

type IndexListener = (snapshot: EagleReferenceSnapshot) => void;

function createEmptySnapshot(): EagleReferenceSnapshot {
	return {
		items: [],
		itemsById: new Map<string, EagleItemReference>(),
		fileToItemIds: new Map<string, string[]>(),
		scannedAt: 0,
		scannedFileCount: 0,
	};
}

function incrementCount(counts: Map<string, number>, itemId: string, increment = 1): void {
	counts.set(itemId, (counts.get(itemId) ?? 0) + increment);
}

function collectItemIdsFromText(raw: string): string[] {
	const pattern = new RegExp(EAGLE_ITEM_INFO_URL_REGEX_SOURCE, 'gi');
	const ids: string[] = [];
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(raw)) !== null) {
		if (match[1]) {
			ids.push(match[1]);
		}
	}

	return ids;
}

function collectMarkdownOccurrences(raw: string): Map<string, number> {
	const counts = new Map<string, number>();

	for (const itemId of collectItemIdsFromText(raw)) {
		incrementCount(counts, itemId);
	}

	return counts;
}

function extractCanvasNodeItemIds(rawUrl: string): string[] {
	const directIds = collectItemIdsFromText(rawUrl);
	if (directIds.length > 0) {
		return directIds;
	}

	if (!EAGLE_CANVAS_PROXY_URL_REGEX.test(rawUrl)) {
		return [];
	}

	try {
		const parsedUrl = new URL(rawUrl);
		const sourceUrl = parsedUrl.searchParams.get('src');
		if (!sourceUrl) {
			return [];
		}

		return collectItemIdsFromText(decodeURIComponent(sourceUrl));
	} catch {
		return [];
	}
}

function collectCanvasOccurrences(raw: string): Map<string, number> {
	const counts = new Map<string, number>();

	try {
		const parsed = JSON.parse(raw) as {
			nodes?: Array<{
				url?: unknown;
				eagleBridgeSourceUrl?: unknown;
			}>;
		};
		const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];

		for (const node of nodes) {
			const nodeItemIds = new Set<string>();
			const candidateUrls = [
				typeof node.url === 'string' ? node.url : null,
				typeof node.eagleBridgeSourceUrl === 'string' ? node.eagleBridgeSourceUrl : null,
			].filter((value): value is string => Boolean(value));

			for (const candidateUrl of candidateUrls) {
				for (const itemId of extractCanvasNodeItemIds(candidateUrl)) {
					nodeItemIds.add(itemId);
				}
			}

			for (const itemId of nodeItemIds) {
				incrementCount(counts, itemId);
			}
		}
	} catch {
		for (const itemId of collectItemIdsFromText(raw)) {
			incrementCount(counts, itemId);
		}
	}

	return counts;
}

export function extractEagleItemIdFromUrl(rawUrl: string): string | null {
	return collectItemIdsFromText(rawUrl)[0] ?? null;
}

function compareStrings(left: string, right: string): number {
	return left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true });
}

function normalizeTags(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value
			.map((entry) => String(entry).trim())
			.filter((entry) => entry.length > 0);
	}

	if (typeof value === 'string') {
		return value
			.split(',')
			.map((entry) => entry.trim())
			.filter((entry) => entry.length > 0);
	}

	return [];
}

function normalizeFileExtension(ext: string): string {
	const trimmed = ext.trim();
	if (!trimmed) {
		return '';
	}

	return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

function getSourceType(file: TFile): EagleReferenceSourceType {
	return file.extension === 'canvas' ? 'canvas' : 'markdown';
}

function getFilteredSourceFiles(app: App): TFile[] {
	return app.vault.getFiles().filter((file) => RELEVANT_FILE_EXTENSIONS.has(file.extension));
}

function readLocalItemMetadata(
	itemId: string,
	libraryPath: string,
	cache: Map<string, EagleLocalItemMetadata | null>,
): EagleLocalItemMetadata | null {
	if (cache.has(itemId)) {
		return cache.get(itemId) ?? null;
	}

	const normalizedLibraryPath = libraryPath.trim();
	if (!normalizedLibraryPath) {
		cache.set(itemId, null);
		return null;
	}

	const metadataPath = path.join(normalizedLibraryPath, 'images', `${itemId}.info`, 'metadata.json');
	if (!fs.existsSync(metadataPath)) {
		cache.set(itemId, null);
		return null;
	}

	try {
		const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as {
			name?: unknown;
			ext?: unknown;
		};
		const name = typeof metadata.name === 'string' && metadata.name.trim().length > 0
			? metadata.name.trim()
			: itemId;
		const ext = typeof metadata.ext === 'string' ? normalizeFileExtension(metadata.ext) : '';
		const localMetadata: EagleLocalItemMetadata = {
			name,
			ext,
			label: ext ? `${name}${ext}` : name,
		};
		cache.set(itemId, localMetadata);
		return localMetadata;
	} catch {
		cache.set(itemId, null);
		return null;
	}
}

function buildItemInfoUrl(itemId: string, port: number): string {
	return `http://localhost:${port}/images/${itemId}.info`;
}

async function fetchLiveItemInfo(itemId: string): Promise<EagleLiveItemInfo | null> {
	const response = await fetch(`${EAGLE_API_BASE_URL}/info?id=${encodeURIComponent(itemId)}`, {
		method: 'GET',
		redirect: 'follow' as RequestRedirect,
	});

	if (!response.ok) {
		return null;
	}

	const result = await response.json();
	if (result?.status !== 'success' || !result.data) {
		return null;
	}

	const data = result.data as {
		id?: unknown;
		name?: unknown;
		ext?: unknown;
		annotation?: unknown;
		url?: unknown;
		tags?: unknown;
	};

	return {
		id: typeof data.id === 'string' ? data.id : itemId,
		name: typeof data.name === 'string' ? data.name : itemId,
		ext: typeof data.ext === 'string' ? normalizeFileExtension(data.ext) : '',
		annotation: typeof data.annotation === 'string' ? data.annotation : '',
		url: typeof data.url === 'string' ? data.url : '',
		tags: normalizeTags(data.tags),
	};
}

async function updateLiveItemInfo(itemId: string, draft: EagleItemDraft): Promise<boolean> {
	const response = await fetch(`${EAGLE_API_BASE_URL}/update`, {
		method: 'POST',
		body: JSON.stringify({
			id: itemId,
			annotation: draft.annotation,
			url: draft.url,
			tags: normalizeTags(draft.tags),
		}),
		redirect: 'follow' as RequestRedirect,
	});

	if (!response.ok) {
		return false;
	}

	const result = await response.json();
	return result?.status === 'success' || result?.status === undefined;
}

async function openItemInObsidian(plugin: MyPlugin, itemId: string): Promise<void> {
	const itemUrl = buildItemInfoUrl(itemId, plugin.settings.port);
	const openMethod = plugin.settings.openInObsidian || 'newPage';

	if (openMethod === 'newPage') {
		window.open(itemUrl, '_blank');
		return;
	}

	if (openMethod === 'popup') {
		const leaf = plugin.app.workspace.getLeaf('window');
		await leaf.setViewState({
			type: 'webviewer',
			state: {
				url: itemUrl,
				navigate: true,
			},
			active: true,
		});
		return;
	}

	const leaf = plugin.app.workspace.getLeaf('split', 'vertical');
	await leaf.setViewState({
		type: 'webviewer',
		state: {
			url: itemUrl,
			navigate: true,
		},
		active: true,
	});
}

async function openFileInDefaultApp(filePath: string): Promise<void> {
	const errorMessage = await shell.openPath(filePath);
	if (errorMessage) {
		throw new Error(errorMessage);
	}
}

async function openFileInOtherApps(filePath: string): Promise<void> {
	if (process.platform !== 'win32') {
		shell.showItemInFolder(filePath);
		return;
	}

	await new Promise<void>((resolve, reject) => {
		const child = spawn('rundll32', ['shell32.dll,OpenAs_RunDLL', filePath], { shell: true });
		child.on('error', reject);
		child.on('exit', (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`EXIT_CODE_${String(code)}`));
		});
	});
}

function resolveLocalFilePath(plugin: MyPlugin, info: EagleLiveItemInfo | null): string | null {
	if (!info) {
		return null;
	}

	const libraryPath = plugin.settings.libraryPath.trim();
	if (!libraryPath) {
		return null;
	}

	return path.join(libraryPath, 'images', `${info.id}.info`, `${info.name}${info.ext}`);
}

export class EagleReferenceIndex {
	private readonly plugin: MyPlugin;
	private readonly listeners = new Set<IndexListener>();
	private readonly metadataCache = new Map<string, EagleLocalItemMetadata | null>();
	private metadataCacheLibraryPath = '';
	private snapshot: EagleReferenceSnapshot = createEmptySnapshot();
	private rebuildTimer: number | null = null;
	private rebuildPromise: Promise<EagleReferenceSnapshot> | null = null;
	private rerunAfterCurrentBuild = false;

	constructor(plugin: MyPlugin) {
		this.plugin = plugin;
	}

	destroy(): void {
		if (this.rebuildTimer !== null) {
			window.clearTimeout(this.rebuildTimer);
			this.rebuildTimer = null;
		}

		this.listeners.clear();
	}

	subscribe(listener: IndexListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	getSnapshot(): EagleReferenceSnapshot {
		return this.snapshot;
	}

	async ensureReady(): Promise<EagleReferenceSnapshot> {
		if (this.snapshot.scannedAt > 0) {
			if (this.rebuildPromise) {
				return this.rebuildPromise;
			}
			return this.snapshot;
		}

		return this.rebuild();
	}

	requestRefresh(delayMs = 350): void {
		if (this.rebuildTimer !== null) {
			window.clearTimeout(this.rebuildTimer);
		}

		this.rebuildTimer = window.setTimeout(() => {
			this.rebuildTimer = null;
			void this.rebuild();
		}, delayMs);
	}

	async rebuild(): Promise<EagleReferenceSnapshot> {
		if (this.rebuildPromise) {
			this.rerunAfterCurrentBuild = true;
			return this.rebuildPromise;
		}

		this.rebuildPromise = this.performRebuild();
		try {
			const nextSnapshot = await this.rebuildPromise;
			this.snapshot = nextSnapshot;
			for (const listener of this.listeners) {
				listener(nextSnapshot);
			}
			return nextSnapshot;
		} finally {
			this.rebuildPromise = null;
			if (this.rerunAfterCurrentBuild) {
				this.rerunAfterCurrentBuild = false;
				void this.rebuild();
			}
		}
	}

	private async performRebuild(): Promise<EagleReferenceSnapshot> {
		const normalizedLibraryPath = this.plugin.settings.libraryPath.trim();
		if (normalizedLibraryPath !== this.metadataCacheLibraryPath) {
			this.metadataCache.clear();
			this.metadataCacheLibraryPath = normalizedLibraryPath;
		}

		const files = getFilteredSourceFiles(this.plugin.app);
		const itemBuilders = new Map<string, EagleItemReference>();
		const fileToItemIds = new Map<string, string[]>();

		for (const file of files) {
			const raw = await this.plugin.app.vault.cachedRead(file);
			const occurrences = file.extension === 'canvas'
				? collectCanvasOccurrences(raw)
				: collectMarkdownOccurrences(raw);

			if (occurrences.size === 0) {
				continue;
			}

			const itemIds = Array.from(occurrences.keys()).sort(compareStrings);
			fileToItemIds.set(file.path, itemIds);

			for (const [itemId, occurrenceCount] of occurrences) {
				const metadata = readLocalItemMetadata(itemId, normalizedLibraryPath, this.metadataCache);
				const item = itemBuilders.get(itemId) ?? {
					itemId,
					displayName: metadata?.label ?? itemId,
					ext: metadata?.ext ?? '',
					referenceCount: 0,
					mentionCount: 0,
					references: [],
				};

				item.references.push({
					file,
					filePath: file.path,
					fileName: file.name,
					sourceType: getSourceType(file),
					occurrenceCount,
				});
				item.referenceCount = item.references.length;
				item.mentionCount += occurrenceCount;
				itemBuilders.set(itemId, item);
			}
		}

		const items = Array.from(itemBuilders.values())
			.map((item) => ({
				...item,
				references: item.references.slice().sort((left, right) => compareStrings(left.filePath, right.filePath)),
			}))
			.sort((left, right) => {
				if (right.referenceCount !== left.referenceCount) {
					return right.referenceCount - left.referenceCount;
				}
				if (right.mentionCount !== left.mentionCount) {
					return right.mentionCount - left.mentionCount;
				}
				return compareStrings(left.displayName, right.displayName);
			});

		return {
			items,
			itemsById: new Map(items.map((item) => [item.itemId, item])),
			fileToItemIds,
			scannedAt: Date.now(),
			scannedFileCount: files.length,
		};
	}
}

export class EagleReferenceView extends ItemView {
	private readonly plugin: MyPlugin;
	private snapshot: EagleReferenceSnapshot = createEmptySnapshot();
	private unsubscribeIndex: (() => void) | null = null;
	private searchTerm = '';
	private searchScope: SearchScope = 'current';
	private selectedItemId: string | null = null;
	private loading = false;
	private statsEl: HTMLElement | null = null;
	private searchInputEl: HTMLInputElement | null = null;
	private scopeCurrentButtonEl: HTMLButtonElement | null = null;
	private scopeAllButtonEl: HTMLButtonElement | null = null;
	private pickerTitleEl: HTMLElement | null = null;
	private pickerMetaEl: HTMLElement | null = null;
	private pickerChipsEl: HTMLElement | null = null;
	private detailsEl: HTMLElement | null = null;
	private detailFetchToken = 0;
	private detailsLoading = false;
	private detailsError = '';
	private detailsItemId: string | null = null;
	private itemDetails: EagleLiveItemInfo | null = null;
	private itemDraft: EagleItemDraft | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: MyPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return EAGLE_REFERENCE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Eagle 引用视图';
	}

	getIcon(): string {
		return 'network';
	}

	async onOpen(): Promise<void> {
		this.buildLayout();
		this.loading = true;
		this.updateStats();

		this.unsubscribeIndex = this.plugin.eagleReferenceIndex.subscribe((snapshot) => {
			this.snapshot = snapshot;
			this.loading = false;
			this.ensureSelectedItem();
			void this.syncSelectedItemDetails();
			this.render();
		});

		this.register(() => {
			this.unsubscribeIndex?.();
			this.unsubscribeIndex = null;
		});

		this.registerEvent(this.app.workspace.on('file-open', () => {
			this.ensureSelectedItem();
			void this.syncSelectedItemDetails();
			this.render();
		}));

		this.snapshot = await this.plugin.eagleReferenceIndex.ensureReady();
		this.loading = false;
		this.ensureSelectedItem();
		await this.syncSelectedItemDetails();
		this.render();
	}

	async setState(state: EagleReferenceViewState, result: ViewStateResult): Promise<void> {
		this.searchTerm = typeof state.searchTerm === 'string' ? state.searchTerm : '';
		this.searchScope = state.searchScope === 'all' ? 'all' : 'current';
		this.selectedItemId = typeof state.selectedItemId === 'string' ? state.selectedItemId : null;

		if (this.searchInputEl) {
			this.searchInputEl.value = this.searchTerm;
		}

		await super.setState(state, result);
		this.ensureSelectedItem();
		await this.syncSelectedItemDetails();
		this.render();
	}

	getState(): EagleReferenceViewState {
		return {
			searchTerm: this.searchTerm,
			searchScope: this.searchScope,
			selectedItemId: this.selectedItemId,
		};
	}

	async focusItem(itemId: string | null): Promise<void> {
		this.snapshot = await this.plugin.eagleReferenceIndex.ensureReady();

		if (itemId && !this.getActiveFileItemIds().includes(itemId)) {
			this.searchScope = 'all';
			this.searchTerm = itemId;
			if (this.searchInputEl) {
				this.searchInputEl.value = this.searchTerm;
			}
		}

		this.selectedItemId = itemId;
		this.ensureSelectedItem();
		await this.syncSelectedItemDetails();
		this.render();
	}

	async refreshIndex(): Promise<void> {
		this.loading = true;
		this.updateStats();
		this.snapshot = await this.plugin.eagleReferenceIndex.rebuild();
		this.ensureSelectedItem();
		await this.syncSelectedItemDetails(true);
		this.render();
	}

	private buildLayout(): void {
		this.contentEl.empty();
		this.contentEl.addClass('eagle-ref-view');

		const toolbarEl = this.contentEl.createDiv({ cls: 'eagle-ref-toolbar' });
		const titleGroupEl = toolbarEl.createDiv({ cls: 'eagle-ref-toolbar-group' });
		titleGroupEl.createDiv({ cls: 'eagle-ref-title', text: 'Eagle 引用视图' });
		this.statsEl = titleGroupEl.createDiv({ cls: 'eagle-ref-stats' });

		const actionsEl = toolbarEl.createDiv({ cls: 'eagle-ref-toolbar-actions' });
		const focusCurrentFileButton = actionsEl.createEl('button', {
			cls: 'clickable-icon eagle-ref-toolbar-button',
			attr: { 'aria-label': '聚焦当前文件中的 Eagle 附件' },
		});
		setIcon(focusCurrentFileButton, 'crosshair');
		focusCurrentFileButton.addEventListener('click', () => {
			if (!this.focusFirstItemInActiveFile()) {
				new Notice('当前文件没有 Eagle 附件引用。');
			}
		});

		const refreshButton = actionsEl.createEl('button', {
			cls: 'clickable-icon eagle-ref-toolbar-button',
			attr: { 'aria-label': '刷新 Eagle 引用索引' },
		});
		setIcon(refreshButton, 'refresh-cw');
		refreshButton.addEventListener('click', () => {
			void this.refreshIndex();
		});

		const searchCardEl = this.contentEl.createDiv({ cls: 'eagle-ref-card eagle-ref-search-card' });
		const searchRowEl = searchCardEl.createDiv({ cls: 'eagle-ref-search-row' });
		this.searchInputEl = searchRowEl.createEl('input', {
			cls: 'eagle-ref-search-input',
			type: 'search',
			placeholder: '搜索附件名、ID、文件名或路径',
		});
		this.searchInputEl.value = this.searchTerm;
		this.searchInputEl.addEventListener('input', () => {
			this.searchTerm = this.searchInputEl?.value.trim() ?? '';
			this.ensureSelectedItem();
			void this.syncSelectedItemDetails();
			this.render();
		});

		const scopeGroupEl = searchRowEl.createDiv({ cls: 'eagle-ref-scope-group' });
		this.scopeCurrentButtonEl = scopeGroupEl.createEl('button', {
			cls: 'eagle-ref-scope-button',
			text: '当前文件',
		});
		this.scopeCurrentButtonEl.addEventListener('click', () => {
			this.searchScope = 'current';
			this.ensureSelectedItem();
			void this.syncSelectedItemDetails();
			this.render();
		});

		this.scopeAllButtonEl = scopeGroupEl.createEl('button', {
			cls: 'eagle-ref-scope-button',
			text: '全部 Eagle',
		});
		this.scopeAllButtonEl.addEventListener('click', () => {
			this.searchScope = 'all';
			this.ensureSelectedItem();
			void this.syncSelectedItemDetails();
			this.render();
		});

		searchCardEl.createDiv({
			cls: 'eagle-ref-search-hint',
			text: '支持仅检索当前文件，或检索全库 Eagle 附件；下方显示当前文件中的 Eagle 附件或检索结果。',
		});

		const pickerCardEl = this.contentEl.createDiv({ cls: 'eagle-ref-card eagle-ref-picker-card' });
		const pickerHeaderEl = pickerCardEl.createDiv({ cls: 'eagle-ref-section-header' });
		this.pickerTitleEl = pickerHeaderEl.createDiv({ cls: 'eagle-ref-section-title' });
		this.pickerMetaEl = pickerHeaderEl.createDiv({ cls: 'eagle-ref-section-meta' });
		this.pickerChipsEl = pickerCardEl.createDiv({ cls: 'eagle-ref-chip-list' });

		this.detailsEl = this.contentEl.createDiv({ cls: 'eagle-ref-details' });
	}

	private render(): void {
		this.loading = false;
		this.updateStats();
		this.updateScopeButtons();
		this.renderPicker();
		this.renderDetails();
	}

	private updateStats(): void {
		if (!this.statsEl) {
			return;
		}

		if (this.loading && this.snapshot.scannedAt === 0) {
			this.statsEl.setText('正在扫描 Markdown / Canvas 中的 Eagle 引用...');
			return;
		}

		this.statsEl.setText(`已索引 ${this.snapshot.items.length} 个 Eagle 附件，来自 ${this.snapshot.fileToItemIds.size} 个文件。`);
	}

	private updateScopeButtons(): void {
		this.scopeCurrentButtonEl?.classList.toggle('is-active', this.searchScope === 'current');
		this.scopeAllButtonEl?.classList.toggle('is-active', this.searchScope === 'all');
	}

	private getActiveFile(): TFile | null {
		const activeFile = this.app.workspace.getActiveFile();
		if (!(activeFile instanceof TFile) || !RELEVANT_FILE_EXTENSIONS.has(activeFile.extension)) {
			return null;
		}

		return activeFile;
	}

	private getActiveFileItemIds(): string[] {
		const activeFile = this.getActiveFile();
		if (!activeFile) {
			return [];
		}

		return this.snapshot.fileToItemIds.get(activeFile.path) ?? [];
	}

	private matchesSearch(item: EagleItemReference): boolean {
		if (!this.searchTerm) {
			return true;
		}

		const query = this.searchTerm.toLocaleLowerCase();
		if (item.displayName.toLocaleLowerCase().includes(query) || item.itemId.toLocaleLowerCase().includes(query)) {
			return true;
		}

		return item.references.some((reference) =>
			reference.fileName.toLocaleLowerCase().includes(query)
			|| reference.filePath.toLocaleLowerCase().includes(query),
		);
	}

	private getPickerItems(): EagleItemReference[] {
		let items: EagleItemReference[] = [];

		if (this.searchTerm) {
			const baseItems = this.searchScope === 'all'
				? this.snapshot.items
				: this.getActiveFileItemIds()
					.map((itemId) => this.snapshot.itemsById.get(itemId))
					.filter((item): item is EagleItemReference => Boolean(item));
			items = baseItems.filter((item) => this.matchesSearch(item));
		} else {
			items = this.getActiveFileItemIds()
				.map((itemId) => this.snapshot.itemsById.get(itemId))
				.filter((item): item is EagleItemReference => Boolean(item));
		}

		items = items.slice().sort((left, right) => {
			if (right.referenceCount !== left.referenceCount) {
				return right.referenceCount - left.referenceCount;
			}
			if (right.mentionCount !== left.mentionCount) {
				return right.mentionCount - left.mentionCount;
			}
			return compareStrings(left.displayName, right.displayName);
		});

		if (this.selectedItemId) {
			const selectedItem = this.snapshot.itemsById.get(this.selectedItemId);
			if (selectedItem && !items.some((item) => item.itemId === selectedItem.itemId)) {
				items.unshift(selectedItem);
			}
		}

		return items;
	}

	private focusFirstItemInActiveFile(): boolean {
		for (const itemId of this.getActiveFileItemIds()) {
			const item = this.snapshot.itemsById.get(itemId);
			if (!item) {
				continue;
			}

			this.selectedItemId = itemId;
			void this.syncSelectedItemDetails();
			this.render();
			return true;
		}

		return false;
	}

	private ensureSelectedItem(): void {
		const pickerItems = this.getPickerItems();
		if (pickerItems.length === 0) {
			this.selectedItemId = null;
			return;
		}

		if (this.selectedItemId && pickerItems.some((item) => item.itemId === this.selectedItemId)) {
			return;
		}

		const activeItemIds = new Set(this.getActiveFileItemIds());
		const preferredItem = pickerItems.find((item) => activeItemIds.has(item.itemId));
		this.selectedItemId = preferredItem?.itemId ?? pickerItems[0].itemId;
	}

	private renderPicker(): void {
		if (!this.pickerTitleEl || !this.pickerMetaEl || !this.pickerChipsEl) {
			return;
		}

		this.pickerTitleEl.empty();
		this.pickerMetaEl.empty();
		this.pickerChipsEl.empty();

		const activeFile = this.getActiveFile();
		const pickerItems = this.getPickerItems();

		this.pickerTitleEl.setText('当前文件中的 Eagle 附件或检索结果');
		if (this.searchTerm) {
			this.pickerMetaEl.setText(
				this.searchScope === 'all'
					? `全库检索，共 ${pickerItems.length} 个结果`
					: `当前文件检索，共 ${pickerItems.length} 个结果`,
			);
		} else {
			this.pickerMetaEl.setText(activeFile ? activeFile.name : '当前没有打开 Markdown / Canvas 文件');
		}

		if (!activeFile && !this.searchTerm) {
			this.pickerChipsEl.createDiv({
				cls: 'eagle-ref-empty',
				text: '打开一个 Markdown 或 Canvas 文件后，这里会列出其中引用的 Eagle 附件。',
			});
			return;
		}

		if (this.searchScope === 'all' && !this.searchTerm && pickerItems.length === 0) {
			this.pickerChipsEl.createDiv({
				cls: 'eagle-ref-empty',
				text: '输入关键词后可在全部 Eagle 附件中检索。',
			});
			return;
		}

		if (pickerItems.length === 0) {
			this.pickerChipsEl.createDiv({
				cls: 'eagle-ref-empty',
				text: this.searchTerm ? '没有匹配的 Eagle 附件。' : '当前文件没有 Eagle 附件引用。',
			});
			return;
		}

		for (const item of pickerItems) {
			const chipEl = this.pickerChipsEl.createEl('button', {
				cls: `eagle-ref-chip ${this.selectedItemId === item.itemId ? 'is-selected' : ''}`,
				text: item.displayName,
			});
			chipEl.setAttribute('title', item.itemId);
			chipEl.addEventListener('click', () => {
				this.selectedItemId = item.itemId;
				void this.syncSelectedItemDetails();
				this.render();
			});
		}
	}

	private renderDetails(): void {
		if (!this.detailsEl) {
			return;
		}

		this.detailsEl.empty();

		const selectedItem = this.selectedItemId ? this.snapshot.itemsById.get(this.selectedItemId) ?? null : null;
		if (!selectedItem) {
			this.detailsEl.createDiv({
				cls: 'eagle-ref-empty eagle-ref-details-empty',
				text: '从上方附件列表中选择一个 Eagle 附件，下面会显示它的详细信息与引用文件。',
			});
			return;
		}

		const summaryCardEl = this.detailsEl.createDiv({ cls: 'eagle-ref-card eagle-ref-summary-card' });
		const summaryHeaderEl = summaryCardEl.createDiv({ cls: 'eagle-ref-summary-header' });
		const summaryTextEl = summaryHeaderEl.createDiv({ cls: 'eagle-ref-summary-text' });
		summaryTextEl.createEl('h3', {
			text: this.itemDetails ? `${this.itemDetails.name}${this.itemDetails.ext}` : selectedItem.displayName,
		});
		summaryTextEl.createDiv({ cls: 'eagle-ref-item-id', text: selectedItem.itemId });
		summaryTextEl.createDiv({
			cls: 'eagle-ref-summary-meta',
			text: `被 ${selectedItem.referenceCount} 个文件引用，共出现 ${selectedItem.mentionCount} 次。`,
		});

		const summaryActionsEl = summaryHeaderEl.createDiv({ cls: 'eagle-ref-summary-actions' });
		const openInEagleButton = summaryActionsEl.createEl('button', { cls: 'mod-cta', text: '在 Eagle 中打开' });
		openInEagleButton.addEventListener('click', () => {
			void shell.openExternal(`eagle://item/${selectedItem.itemId}`);
		});

		const openInObsidianButton = summaryActionsEl.createEl('button', { text: '在 Ob 中打开' });
		openInObsidianButton.addEventListener('click', () => {
			void openItemInObsidian(this.plugin, selectedItem.itemId);
		});

		const openDefaultButton = summaryActionsEl.createEl('button', { text: '默认打开' });
		openDefaultButton.addEventListener('click', () => {
			void this.openSelectedItemFile('default');
		});

		const openOtherButton = summaryActionsEl.createEl('button', { text: '其他应用' });
		openOtherButton.addEventListener('click', () => {
			void this.openSelectedItemFile('other');
		});

		const detailBodyEl = summaryCardEl.createDiv({ cls: 'eagle-ref-detail-body' });
		if (this.detailsLoading && !this.itemDraft) {
			detailBodyEl.createDiv({ cls: 'eagle-ref-empty', text: '正在读取 Eagle 条目详情...' });
		} else if (this.detailsError) {
			detailBodyEl.createDiv({ cls: 'eagle-ref-empty', text: this.detailsError });
		} else {
			const detailGridEl = detailBodyEl.createDiv({ cls: 'eagle-ref-detail-grid' });
			this.renderReadOnlyField(
				detailGridEl,
				'名称',
				this.itemDetails ? `${this.itemDetails.name}${this.itemDetails.ext}` : selectedItem.displayName,
			);
			this.renderReadOnlyField(detailGridEl, '源文件 ID', selectedItem.itemId);
			this.renderEditableField(detailGridEl, 'Annotation', 'textarea', this.itemDraft?.annotation ?? '', (value) => {
				if (this.itemDraft) {
					this.itemDraft.annotation = value;
				}
			});
			this.renderEditableField(detailGridEl, 'URL', 'input', this.itemDraft?.url ?? '', (value) => {
				if (this.itemDraft) {
					this.itemDraft.url = value;
				}
			});
			this.renderEditableField(
				detailGridEl,
				'Tags',
				'input',
				this.itemDraft?.tags ?? '',
				(value) => {
					if (this.itemDraft) {
						this.itemDraft.tags = value;
					}
				},
				'多个标签请用逗号分隔',
			);
		}

		const detailActionBarEl = summaryCardEl.createDiv({ cls: 'eagle-ref-detail-actions' });
		const saveButton = detailActionBarEl.createEl('button', { cls: 'mod-cta', text: '保存到 Eagle' });
		saveButton.disabled = !this.itemDraft || this.detailsLoading;
		saveButton.addEventListener('click', () => {
			void this.saveItemDraft();
		});

		const reloadButton = detailActionBarEl.createEl('button', { text: '重新读取' });
		reloadButton.addEventListener('click', () => {
			void this.syncSelectedItemDetails(true);
		});

		if (this.itemDetails?.url) {
			const openUrlButton = detailActionBarEl.createEl('button', { text: '打开条目 URL' });
			openUrlButton.addEventListener('click', () => {
				window.open(this.itemDetails?.url ?? '', '_blank');
			});
		}

		const fileListCardEl = this.detailsEl.createDiv({ cls: 'eagle-ref-card' });
		fileListCardEl.createDiv({ cls: 'eagle-ref-section-title', text: '引用文件' });
		const fileListEl = fileListCardEl.createDiv({ cls: 'eagle-ref-file-list' });
		const activeFilePath = this.getActiveFile()?.path ?? '';

		const references = selectedItem.references.slice().sort((left, right) => {
			const leftActive = left.filePath === activeFilePath;
			const rightActive = right.filePath === activeFilePath;
			if (leftActive !== rightActive) {
				return leftActive ? -1 : 1;
			}
			if (right.occurrenceCount !== left.occurrenceCount) {
				return right.occurrenceCount - left.occurrenceCount;
			}
			return compareStrings(left.filePath, right.filePath);
		});

		for (const reference of references) {
			const fileRowEl = fileListEl.createDiv({
				cls: `eagle-ref-file-row ${reference.filePath === activeFilePath ? 'is-active' : ''}`,
			});
			fileRowEl.addEventListener('click', () => {
				void this.openReferenceFile(reference.file);
			});

			const fileTextEl = fileRowEl.createDiv({ cls: 'eagle-ref-file-text' });
			fileTextEl.createDiv({ cls: 'eagle-ref-file-name', text: reference.fileName });
			fileTextEl.createDiv({ cls: 'eagle-ref-file-path', text: reference.filePath });

			const fileMetaEl = fileRowEl.createDiv({ cls: 'eagle-ref-file-meta' });
			fileMetaEl.createDiv({
				cls: `eagle-ref-pill ${reference.sourceType === 'canvas' ? 'eagle-ref-pill-canvas' : 'eagle-ref-pill-markdown'}`,
				text: reference.sourceType === 'canvas' ? 'Canvas' : 'Markdown',
			});
			if (reference.occurrenceCount > 1) {
				fileMetaEl.createDiv({ cls: 'eagle-ref-pill eagle-ref-pill-muted', text: `${reference.occurrenceCount} 次` });
			}
		}
	}

	private renderReadOnlyField(parentEl: HTMLElement, label: string, value: string): void {
		const fieldEl = parentEl.createDiv({ cls: 'eagle-ref-field is-readonly' });
		fieldEl.createDiv({ cls: 'eagle-ref-field-label', text: label });
		fieldEl.createDiv({ cls: 'eagle-ref-field-value', text: value || '—' });
	}

	private renderEditableField(
		parentEl: HTMLElement,
		label: string,
		type: 'input' | 'textarea',
		value: string,
		onChange: (nextValue: string) => void,
		description = '',
	): void {
		const fieldEl = parentEl.createDiv({ cls: `eagle-ref-field ${type === 'textarea' ? 'is-wide' : ''}` });
		fieldEl.createDiv({ cls: 'eagle-ref-field-label', text: label });
		if (description) {
			fieldEl.createDiv({ cls: 'eagle-ref-field-desc', text: description });
		}

		if (type === 'textarea') {
			const textareaEl = fieldEl.createEl('textarea', { cls: 'eagle-ref-input eagle-ref-textarea' });
			textareaEl.value = value;
			textareaEl.addEventListener('input', () => {
				onChange(textareaEl.value);
			});
			return;
		}

		const inputEl = fieldEl.createEl('input', { cls: 'eagle-ref-input', type: 'text' });
		inputEl.value = value;
		inputEl.addEventListener('input', () => {
			onChange(inputEl.value);
		});
	}

	private async syncSelectedItemDetails(force = false): Promise<void> {
		const itemId = this.selectedItemId;
		if (!itemId) {
			this.detailsItemId = null;
			this.detailsLoading = false;
			this.detailsError = '';
			this.itemDetails = null;
			this.itemDraft = null;
			this.renderDetails();
			return;
		}

		if (!force && this.detailsItemId === itemId && (this.itemDetails || this.detailsError)) {
			return;
		}

		this.detailsItemId = itemId;
		this.detailsLoading = true;
		this.detailsError = '';
		this.itemDetails = null;
		this.itemDraft = null;
		this.renderDetails();

		const token = ++this.detailFetchToken;
		try {
			const liveInfo = await fetchLiveItemInfo(itemId);
			if (token !== this.detailFetchToken) {
				return;
			}

			if (!liveInfo) {
				this.detailsLoading = false;
				this.detailsError = '无法从 Eagle 读取该附件的实时详情，请确认 Eagle 正在运行。';
				this.renderDetails();
				return;
			}

			this.detailsLoading = false;
			this.detailsError = '';
			this.itemDetails = liveInfo;
			this.itemDraft = {
				annotation: liveInfo.annotation,
				url: liveInfo.url,
				tags: liveInfo.tags.join(', '),
			};
			this.renderDetails();
		} catch {
			if (token !== this.detailFetchToken) {
				return;
			}

			this.detailsLoading = false;
			this.detailsError = '读取 Eagle 实时详情失败。';
			this.renderDetails();
		}
	}

	private async saveItemDraft(): Promise<void> {
		if (!this.selectedItemId || !this.itemDraft) {
			return;
		}

		const saved = await updateLiveItemInfo(this.selectedItemId, this.itemDraft);
		if (!saved) {
			new Notice('保存到 Eagle 失败。');
			return;
		}

		new Notice('已保存到 Eagle。');
		await this.syncSelectedItemDetails(true);
	}

	private async openSelectedItemFile(mode: 'default' | 'other'): Promise<void> {
		const selectedItem = this.selectedItemId;
		if (!selectedItem) {
			return;
		}

		const details = this.itemDetails ?? await fetchLiveItemInfo(selectedItem);
		if (!details) {
			new Notice('无法读取 Eagle 文件路径。');
			return;
		}

		this.itemDetails = details;
		const filePath = resolveLocalFilePath(this.plugin, details);
		if (!filePath || !fs.existsSync(filePath)) {
			new Notice('找不到本地源文件，请确认 Eagle 库路径设置正确。');
			return;
		}

		try {
			if (mode === 'default') {
				await openFileInDefaultApp(filePath);
			} else {
				await openFileInOtherApps(filePath);
			}
		} catch {
			new Notice('打开文件失败。');
		}
	}

	private async openReferenceFile(file: TFile): Promise<void> {
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(file, { active: true });
		await this.app.workspace.revealLeaf(leaf);
	}
}

export async function activateEagleReferenceView(
	plugin: MyPlugin,
	options: { itemId?: string | null } = {},
): Promise<EagleReferenceView> {
	const existingLeaf = plugin.app.workspace.getLeavesOfType(EAGLE_REFERENCE_VIEW_TYPE)[0];
	const targetLeaf = existingLeaf ?? plugin.app.workspace.getRightLeaf(false) ?? plugin.app.workspace.getLeaf('split', 'vertical');

	await targetLeaf.setViewState({
		type: EAGLE_REFERENCE_VIEW_TYPE,
		active: true,
	});
	await plugin.app.workspace.revealLeaf(targetLeaf);

	if (!(targetLeaf.view instanceof EagleReferenceView)) {
		throw new Error('Failed to open Eagle reference view.');
	}

	if (typeof options.itemId !== 'undefined') {
		await targetLeaf.view.focusItem(options.itemId);
	}

	return targetLeaf.view;
}
