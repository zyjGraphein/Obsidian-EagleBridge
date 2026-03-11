import { MarkdownView, Modal, Notice, TFile } from 'obsidian';
import type MyPlugin from './main';
import type { EagleFileReference, EagleItemReference } from './eagleReferenceView';

const EAGLE_MOVE_TO_TRASH_API = 'http://localhost:41595/api/item/moveToTrash';
const EAGLE_ITEM_INFO_URL_REGEX_SOURCE = 'http:\\/\\/localhost:\\d+\\/images\\/([^/?#\\s]+)\\.info';
const EAGLE_CANVAS_PROXY_URL_REGEX = /^http:\/\/localhost:\d+\/__eaglebridge__\/canvas-(?:image|resource)\?/i;

type CurrentLinkDeleteMode = 'precise-current-link' | 'current-file-links';

interface MarkdownRemovalResult {
	nextContent: string;
	removedCount: number;
}

export interface DeleteEagleAttachmentOptions {
	plugin: MyPlugin;
	item: EagleItemReference;
	itemUrl: string;
	contextTitle: string;
	currentLinkMode?: CurrentLinkDeleteMode;
	currentLinkFile?: TFile | null;
	currentLinkTargetPos?: number | null;
	afterChange?: () => void | Promise<void>;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildMarkdownLinkRegex(url: string): RegExp {
	return new RegExp(`!?\\[[^\\]\\r\\n]*\\]\\s*\\(${escapeRegExp(url)}[^)\\r\\n]*\\)`, 'g');
}

function findMarkdownLinkRangesInLine(line: string, url: string): Array<[number, number]> {
	const ranges: Array<[number, number]> = [];
	const regex = buildMarkdownLinkRegex(url);
	let match: RegExpExecArray | null;

	while ((match = regex.exec(line)) !== null) {
		ranges.push([match.index, match.index + match[0].length]);
	}

	return ranges;
}

function removeMarkdownLinksFromText(raw: string, url: string): MarkdownRemovalResult {
	const regex = buildMarkdownLinkRegex(url);
	let removedCount = 0;
	const nextContent = raw.replace(regex, () => {
		removedCount += 1;
		return '';
	});

	return {
		nextContent,
		removedCount,
	};
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

function canvasNodeMatchesItemId(node: Record<string, unknown>, itemId: string): boolean {
	const candidateUrls = [
		typeof node.url === 'string' ? node.url : null,
		typeof node.eagleBridgeSourceUrl === 'string' ? node.eagleBridgeSourceUrl : null,
	].filter((value): value is string => Boolean(value));

	for (const candidateUrl of candidateUrls) {
		if (extractCanvasNodeItemIds(candidateUrl).includes(itemId)) {
			return true;
		}
	}

	return false;
}

export function getCurrentFileReference(item: EagleItemReference, file: TFile | null): EagleFileReference | null {
	if (!file) {
		return null;
	}

	return item.references.find((reference) => reference.file.path === file.path) ?? null;
}

export function canDeleteCurrentLink(item: EagleItemReference, file: TFile | null): boolean {
	return Boolean(getCurrentFileReference(item, file));
}

export async function removeCurrentLinkFromEditor(plugin: MyPlugin, url: string, targetPos: number): Promise<number> {
	const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
	if (!activeView) {
		new Notice('无法获取当前编辑器。');
		return 0;
	}

	const editor = activeView.editor;
	const editorView = (editor as any).cm;
	if (!editorView?.state?.doc) {
		new Notice('当前编辑器不支持精确删除链接。');
		return 0;
	}

	const targetLine = editorView.state.doc.lineAt(targetPos);
	const lineText = targetLine.text;
	const ranges = findMarkdownLinkRangesInLine(url, lineText);
	if (ranges.length === 0) {
		new Notice('没有找到当前链接。');
		return 0;
	}

	const relativePos = targetPos - targetLine.from;
	const matchRange = ranges.find(([from, to]) => relativePos >= from && relativePos <= to)
		?? (ranges.length === 1 ? ranges[0] : null);
	if (!matchRange) {
		new Notice('当前行存在多个相同链接，未执行删除以避免误删。');
		return 0;
	}

	editor.replaceRange(
		'',
		{ line: targetLine.number - 1, ch: matchRange[0] },
		{ line: targetLine.number - 1, ch: matchRange[1] },
	);
	editor.focus();
	return 1;
}

export async function removeAllLinksFromMarkdownFile(plugin: MyPlugin, file: TFile, url: string): Promise<number> {
	const raw = await plugin.app.vault.read(file);
	const { nextContent, removedCount } = removeMarkdownLinksFromText(raw, url);
	if (removedCount > 0 && nextContent !== raw) {
		await plugin.app.vault.modify(file, nextContent);
	}

	return removedCount;
}

export async function removeAllLinksFromCanvasFile(plugin: MyPlugin, file: TFile, itemId: string): Promise<number> {
	const raw = await plugin.app.vault.read(file);
	if (!raw.trim()) {
		return 0;
	}

	const parsed = JSON.parse(raw) as {
		nodes?: Array<Record<string, unknown>>;
		edges?: Array<Record<string, unknown>>;
	};

	const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
	const edges = Array.isArray(parsed.edges) ? parsed.edges : [];
	const removedNodeIds = new Set<string>();
	const nextNodes = nodes.filter((node) => {
		if (!canvasNodeMatchesItemId(node, itemId)) {
			return true;
		}

		if (typeof node.id === 'string') {
			removedNodeIds.add(node.id);
		}
		return false;
	});

	if (removedNodeIds.size === 0) {
		return 0;
	}

	const nextEdges = edges.filter((edge) => {
		const fromNode = typeof edge.fromNode === 'string' ? edge.fromNode : null;
		const toNode = typeof edge.toNode === 'string' ? edge.toNode : null;
		return !removedNodeIds.has(fromNode ?? '') && !removedNodeIds.has(toNode ?? '');
	});

	const nextContent = `${JSON.stringify({
		...parsed,
		nodes: nextNodes,
		edges: nextEdges,
	}, null, 2)}\n`;
	await plugin.app.vault.modify(file, nextContent);
	return removedNodeIds.size;
}

export async function removeAllLinksFromFile(plugin: MyPlugin, file: TFile, itemId: string, url: string): Promise<number> {
	if (file.extension === 'canvas') {
		return removeAllLinksFromCanvasFile(plugin, file, itemId);
	}

	return removeAllLinksFromMarkdownFile(plugin, file, url);
}

export async function removeAllLinksForItem(
	plugin: MyPlugin,
	item: EagleItemReference,
	url: string,
	references: EagleFileReference[] = item.references,
): Promise<{ fileCount: number; mentionCount: number }> {
	let fileCount = 0;
	let mentionCount = 0;

	for (const reference of references) {
		const removedCount = await removeAllLinksFromFile(plugin, reference.file, item.itemId, url);
		if (removedCount > 0) {
			fileCount += 1;
			mentionCount += removedCount;
		}
	}

	return { fileCount, mentionCount };
}

export async function moveItemToTrash(itemId: string): Promise<boolean> {
	const response = await fetch(EAGLE_MOVE_TO_TRASH_API, {
		method: 'POST',
		body: JSON.stringify({
			itemIds: [itemId],
		}),
		redirect: 'follow' as RequestRedirect,
	});

	if (!response.ok) {
		return false;
	}

	const result = await response.json();
	return result?.status === 'success';
}

class DeleteEagleAttachmentModal extends Modal {
	private readonly options: DeleteEagleAttachmentOptions;

	constructor(plugin: MyPlugin, options: DeleteEagleAttachmentOptions) {
		super(plugin.app);
		this.options = options;
	}

	onOpen(): void {
		const { contentEl } = this;
		const { item, currentLinkFile, currentLinkMode } = this.options;
		const currentFileReference = getCurrentFileReference(item, currentLinkFile ?? null);
		const canDeleteCurrent = currentLinkMode === 'precise-current-link'
			|| (currentLinkMode === 'current-file-links' && Boolean(currentFileReference));

		contentEl.empty();
		contentEl.addClass('eagle-delete-modal');
		contentEl.createEl('h2', { text: '删除 Eagle 附件' });
		contentEl.createEl('p', {
			text: `${this.options.contextTitle}。该附件被 ${item.referenceCount} 个文件引用，共出现 ${item.mentionCount} 次。`,
		});

		if (currentLinkMode === 'current-file-links' && currentLinkFile) {
			const hint = currentFileReference
				? `当前文件：${currentLinkFile.path}，其中出现 ${currentFileReference.occurrenceCount} 次。`
				: `当前文件：${currentLinkFile.path}，但未检测到该附件引用。`;
			contentEl.createEl('p', { text: hint, cls: 'eagle-delete-modal-hint' });
		}

		const actionsEl = contentEl.createDiv({ cls: 'eagle-delete-modal-actions' });

		const cancelButton = actionsEl.createEl('button', { text: '取消' });
		cancelButton.addEventListener('click', () => this.close());

		const currentDeleteLabel = currentLinkMode === 'current-file-links'
			? '只删除当前文件中的链接'
			: '只删除当前链接';
		const removeCurrentButton = actionsEl.createEl('button', { text: currentDeleteLabel });
		removeCurrentButton.disabled = !canDeleteCurrent;
		removeCurrentButton.addEventListener('click', () => {
			void this.runAction('remove-current-link');
		});

		const removeCurrentAndAttachmentButton = actionsEl.createEl('button', {
			text: currentLinkMode === 'current-file-links' ? '删除附件和当前文件中的链接' : '删除附件和当前链接',
			cls: 'mod-warning',
		});
		removeCurrentAndAttachmentButton.disabled = !canDeleteCurrent;
		removeCurrentAndAttachmentButton.addEventListener('click', () => {
			void this.runAction('remove-current-and-attachment');
		});

		const removeAllButton = actionsEl.createEl('button', {
			text: '删除附件并删除所有链接',
			cls: 'mod-warning',
		});
		removeAllButton.addEventListener('click', () => {
			void this.runAction('remove-all-and-attachment');
		});
	}

	private async runAction(
		mode: 'remove-current-link' | 'remove-current-and-attachment' | 'remove-all-and-attachment',
	): Promise<void> {
		const { plugin, item, itemUrl, currentLinkMode, currentLinkFile, currentLinkTargetPos, afterChange } = this.options;

		try {
			if (mode === 'remove-current-link' || mode === 'remove-current-and-attachment') {
				let removed = 0;
				if (currentLinkMode === 'precise-current-link' && typeof currentLinkTargetPos === 'number') {
					removed = await removeCurrentLinkFromEditor(plugin, itemUrl, currentLinkTargetPos);
				} else if (currentLinkMode === 'current-file-links' && currentLinkFile) {
					removed = await removeAllLinksFromFile(plugin, currentLinkFile, item.itemId, itemUrl);
				}

				if (removed <= 0) {
					new Notice('没有删除任何链接，为避免误删，未执行附件删除。');
					return;
				}

				if (mode === 'remove-current-link') {
					await afterChange?.();
					new Notice('已删除当前链接。');
					this.close();
					return;
				}

				const moved = await moveItemToTrash(item.itemId);
				if (!moved) {
					new Notice('Eagle 附件删除失败。');
					return;
				}

				await afterChange?.();
				new Notice('已删除 Eagle 附件和当前链接。');
				this.close();
				return;
			}

			const removedSummary = await removeAllLinksForItem(plugin, item, itemUrl);
			const moved = await moveItemToTrash(item.itemId);
			if (!moved) {
				new Notice('Eagle 附件删除失败，未回滚已删除的链接。');
				return;
			}

			await afterChange?.();
			new Notice(`已删除 Eagle 附件，并移除 ${removedSummary.fileCount} 个文件中的 ${removedSummary.mentionCount} 处链接。`);
			this.close();
		} catch (error) {
			console.error(error);
			new Notice('删除操作失败。');
		}
	}
}

export function openDeleteEagleAttachmentModal(options: DeleteEagleAttachmentOptions): void {
	new DeleteEagleAttachmentModal(options.plugin, options).open();
}
