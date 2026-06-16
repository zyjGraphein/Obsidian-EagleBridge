import { MarkdownView, Modal, Notice, TFile } from 'obsidian';
import type MyPlugin from './main';
import type { EagleFileReference, EagleItemReference } from './eagleReferenceView';
import { moveItemToTrashInLibrary } from './eagleApi';
import { extractEagleLinkTarget, findLibraryProfileByPort } from './libraryProfiles';

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
		new Notice('Could not access the current editor.');
		return 0;
	}

	const editor = activeView.editor;
	const editorView = (editor as any).cm;
	if (!editorView?.state?.doc) {
		new Notice('The current editor does not support precise link removal.');
		return 0;
	}

	const targetLine = editorView.state.doc.lineAt(targetPos);
	const lineText = targetLine.text;
	const ranges = findMarkdownLinkRangesInLine(url, lineText);
	if (ranges.length === 0) {
		new Notice('The current link was not found.');
		return 0;
	}

	const relativePos = targetPos - targetLine.from;
	const matchRange = ranges.find(([from, to]) => relativePos >= from && relativePos <= to)
		?? (ranges.length === 1 ? ranges[0] : null);
	if (!matchRange) {
		new Notice('Multiple matching links were found on this line, so nothing was removed.');
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

export async function moveItemToTrash(plugin: MyPlugin, itemUrl: string, itemId: string): Promise<boolean> {
	const target = extractEagleLinkTarget(itemUrl);
	const profile = target ? findLibraryProfileByPort(plugin.settings, target.port) : null;
	if (!profile?.resolvedPath) {
		return false;
	}

	return moveItemToTrashInLibrary(profile, itemId);
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
		contentEl.createEl('h2', { text: 'Delete Eagle item' });
		contentEl.createEl('p', {
			text: `${this.options.contextTitle}. This item is referenced by ${item.referenceCount} file${item.referenceCount === 1 ? '' : 's'} and appears ${item.mentionCount} time${item.mentionCount === 1 ? '' : 's'}.`,
		});

		if (currentLinkMode === 'current-file-links' && currentLinkFile) {
			const hint = currentFileReference
				? `Current file: ${currentLinkFile.path}. It appears ${currentFileReference.occurrenceCount} time${currentFileReference.occurrenceCount === 1 ? '' : 's'} here.`
				: `Current file: ${currentLinkFile.path}. No reference to this item was detected here.`;
			contentEl.createEl('p', { text: hint, cls: 'eagle-delete-modal-hint' });
		}

		const actionsEl = contentEl.createDiv({ cls: 'eagle-delete-modal-actions' });

		const cancelButton = actionsEl.createEl('button', { text: 'Cancel' });
		cancelButton.addEventListener('click', () => this.close());

		const currentDeleteLabel = currentLinkMode === 'current-file-links'
			? 'Remove links from current file only'
			: 'Remove current link only';
		const removeCurrentButton = actionsEl.createEl('button', { text: currentDeleteLabel });
		removeCurrentButton.disabled = !canDeleteCurrent;
		removeCurrentButton.addEventListener('click', () => {
			void this.runAction('remove-current-link');
		});

		const removeCurrentAndAttachmentButton = actionsEl.createEl('button', {
			text: currentLinkMode === 'current-file-links' ? 'Delete item and current file links' : 'Delete item and current link',
			cls: 'mod-warning',
		});
		removeCurrentAndAttachmentButton.disabled = !canDeleteCurrent;
		removeCurrentAndAttachmentButton.addEventListener('click', () => {
			void this.runAction('remove-current-and-attachment');
		});

		const removeAllButton = actionsEl.createEl('button', {
			text: 'Delete item and all links',
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
					new Notice('No links were removed, so the Eagle item was left untouched.');
					return;
				}

				if (mode === 'remove-current-link') {
					await afterChange?.();
					new Notice('Removed the current link.');
					this.close();
					return;
				}

				const moved = await moveItemToTrash(plugin, itemUrl, item.itemId);
				if (!moved) {
					new Notice('Failed to delete the Eagle item.');
					return;
				}

				await afterChange?.();
				new Notice('Deleted the Eagle item and the current link.');
				this.close();
				return;
			}

			const removedSummary = await removeAllLinksForItem(plugin, item, itemUrl);
			const moved = await moveItemToTrash(plugin, itemUrl, item.itemId);
			if (!moved) {
				new Notice('Failed to delete the Eagle item. Removed links were not rolled back.');
				return;
			}

			await afterChange?.();
			new Notice(`Deleted the Eagle item and removed ${removedSummary.mentionCount} link${removedSummary.mentionCount === 1 ? '' : 's'} from ${removedSummary.fileCount} file${removedSummary.fileCount === 1 ? '' : 's'}.`);
			this.close();
		} catch (error) {
			console.error(error);
			new Notice('Delete action failed.');
		}
	}
}

export function openDeleteEagleAttachmentModal(options: DeleteEagleAttachmentOptions): void {
	new DeleteEagleAttachmentModal(options.plugin, options).open();
}
