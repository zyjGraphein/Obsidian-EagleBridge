import * as fs from 'fs';
import * as path from 'path';
import {
	App,
	FileSystemAdapter,
	Modal,
	Notice,
	Setting,
	TFile,
	type CachedMetadata,
	type Reference,
} from 'obsidian';
import type MyPlugin from './main';
import { isPathInsideDirectory } from './eaglePaths';
import { resolveFilePathToEagleLink, type ResolvedEagleLink } from './urlHandler';

const NON_ATTACHMENT_EXTENSIONS = new Set(['md', 'canvas', 'base']);
const WIKILINK_REGEX = /^(!?)\[\[([\s\S]*?)\]\]$/;
const MARKDOWN_LINK_REGEX = /^(!?)\[([\s\S]*?)\]\(([\s\S]*?)\)$/;
const IMAGE_SIZE_REGEX = /^\d+(?:x\d+)?$/i;

interface ParsedOriginalReference {
	embed: boolean;
	label: string | null;
	imageSize: string | null;
}

interface AttachmentOccurrence {
	key: string;
	sourceFile: TFile;
	startOffset: number;
	endOffset: number;
	originalText: string;
	parsedReference: ParsedOriginalReference;
}

interface AttachmentTargetPlan {
	sourceFile: TFile;
	absolutePath: string;
	occurrences: AttachmentOccurrence[];
	otherMarkdownReferences: TFile[];
	otherCanvasReferences: TFile[];
	remainingCurrentReferences: number;
	sourceAlreadyInEagleLibrary: boolean;
}

interface AttachmentBatchPlan {
	file: TFile;
	originalContent: string;
	targets: AttachmentTargetPlan[];
}

interface DeletionSkipInfo {
	sourceFile: TFile;
	otherMarkdownReferences: TFile[];
	otherCanvasReferences: TFile[];
	remainingCurrentReferences: number;
	sourceAlreadyInEagleLibrary: boolean;
	deletionError: string | null;
}

interface ReplacementOperation {
	startOffset: number;
	endOffset: number;
	originalText: string;
	replacementText: string;
}

interface UploadExecutionStats {
	uploadedCount: number;
	reusedCount: number;
	replacedCount: number;
	deletedCount: number;
	skippedDeletionCount: number;
	retainedByReferenceCount: number;
}

export async function uploadCurrentMarkdownAttachmentsToEagle(plugin: MyPlugin): Promise<void> {
	const activeFile = plugin.app.workspace.getActiveFile();
	if (!(activeFile instanceof TFile) || activeFile.extension !== 'md') {
		new Notice('请先打开一个 Markdown 文档。');
		return;
	}

	if (!(plugin.app.vault.adapter instanceof FileSystemAdapter)) {
		new Notice('该命令仅支持桌面端文件系统仓库。');
		return;
	}

	let plan: AttachmentBatchPlan;
	try {
		plan = await buildAttachmentBatchPlan(plugin.app, activeFile, plugin.settings.libraryPath);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message === 'FILE_CACHE_UNAVAILABLE') {
			new Notice('当前文档的链接缓存尚未就绪，请稍后再试。');
			return;
		}

		if (message === 'FILESYSTEM_ADAPTER_REQUIRED') {
			new Notice('该命令仅支持桌面端文件系统仓库。');
			return;
		}

		new Notice(`分析当前文档附件失败：${message}`, 10000);
		return;
	}

	if (plan.targets.length === 0) {
		new Notice('当前文档中没有可上传到 Eagle 的本地附件引用。');
		return;
	}

	const resolvedLinks = new Map<string, ResolvedEagleLink>();
	const uploadStats = {
		uploadedCount: 0,
		reusedCount: 0,
	};

	try {
		for (const target of plan.targets) {
			const resolvedLink = await resolveFilePathToEagleLink(target.absolutePath, plugin);
			resolvedLinks.set(target.sourceFile.path, resolvedLink);
			if (target.sourceAlreadyInEagleLibrary) {
				uploadStats.reusedCount += 1;
			} else {
				uploadStats.uploadedCount += 1;
			}
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		new Notice(`上传到 Eagle 失败，正文未修改，源附件未删除。失败原因：${message}`, 10000);
		return;
	}

	const replacements = buildReplacementOperations(plan, resolvedLinks);
	if (replacements.length === 0) {
		new Notice('没有生成任何可替换的 Eagle 链接。');
		return;
	}

	try {
		await plugin.app.vault.process(activeFile, (currentContent) => {
			if (currentContent !== plan.originalContent) {
				throw new Error('SOURCE_FILE_CHANGED');
			}

			return applyReplacementOperations(currentContent, replacements);
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message === 'SOURCE_FILE_CHANGED') {
			new Notice('当前文档在上传过程中已被修改。为避免替换错位，本次未写入回链，也未删除原附件。', 10000);
			return;
		}

		if (message === 'REPLACEMENT_MISMATCH') {
			new Notice('文档中的附件位置与缓存分析不一致。为避免误删正文，本次已中止。', 10000);
			return;
		}

		new Notice(`写入 Eagle 回链失败，原附件未删除。失败原因：${message}`, 10000);
		return;
	}

	const deletionSkips: DeletionSkipInfo[] = [];
	let deletedCount = 0;
	for (const target of plan.targets) {
		if (!canDeleteOriginalAttachment(target)) {
			deletionSkips.push({
				sourceFile: target.sourceFile,
				otherMarkdownReferences: target.otherMarkdownReferences,
				otherCanvasReferences: target.otherCanvasReferences,
				remainingCurrentReferences: target.remainingCurrentReferences,
				sourceAlreadyInEagleLibrary: target.sourceAlreadyInEagleLibrary,
				deletionError: null,
			});
			continue;
		}

		try {
			await plugin.app.vault.trash(target.sourceFile, true);
			deletedCount += 1;
		} catch (error) {
			deletionSkips.push({
				sourceFile: target.sourceFile,
				otherMarkdownReferences: target.otherMarkdownReferences,
				otherCanvasReferences: target.otherCanvasReferences,
				remainingCurrentReferences: target.remainingCurrentReferences,
				sourceAlreadyInEagleLibrary: target.sourceAlreadyInEagleLibrary,
				deletionError: error instanceof Error ? error.message : String(error),
			});
		}
	}

	const stats: UploadExecutionStats = {
		uploadedCount: uploadStats.uploadedCount,
		reusedCount: uploadStats.reusedCount,
		replacedCount: replacements.length,
		deletedCount,
		skippedDeletionCount: deletionSkips.length,
		retainedByReferenceCount: deletionSkips.filter((skip) =>
			skip.otherMarkdownReferences.length > 0 || skip.otherCanvasReferences.length > 0,
		).length,
	};

	if (deletionSkips.length > 0) {
		new Notice(`有 ${deletionSkips.length} 个原附件未自动删除，已保留并打开详情窗口。`, 12000);
		new AttachmentDeletionReportModal(plugin.app, buildDeletionReportText(activeFile, deletionSkips)).open();
	}

	new Notice(buildCompletionMessage(stats), 12000);
}

async function buildAttachmentBatchPlan(
	app: App,
	file: TFile,
	libraryPath: string,
): Promise<AttachmentBatchPlan> {
	const originalContent = await app.vault.read(file);
	const fileCache = app.metadataCache.getFileCache(file);
	if (!fileCache) {
		throw new Error('FILE_CACHE_UNAVAILABLE');
	}

	const occurrences = collectAttachmentOccurrences(app, file, fileCache, originalContent);
	const currentReferenceCounts = collectCurrentAttachmentReferenceCounts(app, file, fileCache);
	const canvasReferenceIndex = await buildCanvasAttachmentReferenceIndex(app);
	const adapter = app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) {
		throw new Error('FILESYSTEM_ADAPTER_REQUIRED');
	}

	const targetsByPath = new Map<string, AttachmentTargetPlan>();
	for (const occurrence of occurrences) {
		const existingTarget = targetsByPath.get(occurrence.sourceFile.path);
		if (existingTarget) {
			existingTarget.occurrences.push(occurrence);
			continue;
		}

		const absolutePath = path.join(adapter.getBasePath(), occurrence.sourceFile.path);
		if (!fs.existsSync(absolutePath)) {
			continue;
		}

		targetsByPath.set(occurrence.sourceFile.path, {
			sourceFile: occurrence.sourceFile,
			absolutePath,
			occurrences: [occurrence],
			otherMarkdownReferences: getOtherMarkdownReferences(app, file, occurrence.sourceFile),
			otherCanvasReferences: canvasReferenceIndex.get(occurrence.sourceFile.path) ?? [],
			remainingCurrentReferences: 0,
			sourceAlreadyInEagleLibrary: libraryPath
				? isPathInsideDirectory(absolutePath, libraryPath)
				: false,
		});
	}

	for (const target of targetsByPath.values()) {
		const totalCurrentReferences = currentReferenceCounts.get(target.sourceFile.path) ?? target.occurrences.length;
		target.remainingCurrentReferences = Math.max(0, totalCurrentReferences - target.occurrences.length);
	}

	return {
		file,
		originalContent,
		targets: Array.from(targetsByPath.values()).sort((left, right) => {
			const leftOffset = left.occurrences[0]?.startOffset ?? Number.MAX_SAFE_INTEGER;
			const rightOffset = right.occurrences[0]?.startOffset ?? Number.MAX_SAFE_INTEGER;
			return leftOffset - rightOffset;
		}),
	};
}

function collectAttachmentOccurrences(
	app: App,
	file: TFile,
	cache: CachedMetadata,
	content: string,
): AttachmentOccurrence[] {
	const references = [...(cache.embeds ?? []), ...(cache.links ?? [])];
	const occurrences: AttachmentOccurrence[] = [];
	const seenKeys = new Set<string>();

	for (const reference of references) {
		const sourceFile = resolveAttachmentFile(app, file, reference);
		if (!sourceFile) {
			continue;
		}

		const startOffset = reference.position?.start?.offset;
		const endOffset = reference.position?.end?.offset;
		if (!Number.isFinite(startOffset) || !Number.isFinite(endOffset) || startOffset < 0 || endOffset <= startOffset) {
			continue;
		}

		const key = `${startOffset}:${endOffset}`;
		if (seenKeys.has(key)) {
			continue;
		}

		const originalText = content.slice(startOffset, endOffset);
		if (!originalText || !looksLikeAttachmentReference(originalText)) {
			continue;
		}

		seenKeys.add(key);
		occurrences.push({
			key,
			sourceFile,
			startOffset,
			endOffset,
			originalText,
			parsedReference: parseOriginalReference(originalText),
		});
	}

	return occurrences.sort((left, right) => left.startOffset - right.startOffset);
}

function collectCurrentAttachmentReferenceCounts(
	app: App,
	file: TFile,
	cache: CachedMetadata,
): Map<string, number> {
	const counts = new Map<string, number>();
	const references: Reference[] = [
		...(cache.links ?? []),
		...(cache.embeds ?? []),
		...(cache.frontmatterLinks ?? []),
	];

	for (const reference of references) {
		const resolvedFile = resolveAttachmentFile(app, file, reference);
		if (!resolvedFile) {
			continue;
		}

		counts.set(resolvedFile.path, (counts.get(resolvedFile.path) ?? 0) + 1);
	}

	return counts;
}

function resolveAttachmentFile(app: App, sourceFile: TFile, reference: Reference): TFile | null {
	const resolvedFile = app.metadataCache.getFirstLinkpathDest(reference.link, sourceFile.path);
	if (!(resolvedFile instanceof TFile)) {
		return null;
	}

	if (NON_ATTACHMENT_EXTENSIONS.has(resolvedFile.extension.toLowerCase())) {
		return null;
	}

	return resolvedFile;
}

function getOtherMarkdownReferences(app: App, sourceFile: TFile, targetFile: TFile): TFile[] {
	const referencingFiles: TFile[] = [];

	for (const markdownFile of app.vault.getMarkdownFiles()) {
		if (markdownFile.path === sourceFile.path) {
			continue;
		}

		const fileCache = app.metadataCache.getFileCache(markdownFile);
		if (!fileCache) {
			continue;
		}

		const references: Reference[] = [
			...(fileCache.links ?? []),
			...(fileCache.embeds ?? []),
			...(fileCache.frontmatterLinks ?? []),
		];

		const hasReference = references.some((reference) => {
			const resolvedFile = app.metadataCache.getFirstLinkpathDest(reference.link, markdownFile.path);
			return resolvedFile?.path === targetFile.path;
		});

		if (hasReference) {
			referencingFiles.push(markdownFile);
		}
	}

	return referencingFiles.sort((left, right) => left.path.localeCompare(right.path));
}

async function buildCanvasAttachmentReferenceIndex(app: App): Promise<Map<string, TFile[]>> {
	const index = new Map<string, TFile[]>();
	const canvasFiles = app.vault.getFiles().filter((file) => file.extension === 'canvas');

	await Promise.all(canvasFiles.map(async (canvasFile) => {
		try {
			const raw = await app.vault.read(canvasFile);
			if (!raw.trim()) {
				return;
			}

			const parsed = JSON.parse(raw) as { nodes?: Array<{ type?: unknown; file?: unknown }> };
			const referencedPaths = new Set<string>();

			for (const node of parsed.nodes ?? []) {
				if (node?.type !== 'file' || typeof node.file !== 'string') {
					continue;
				}

				const resolvedFile = app.metadataCache.getFirstLinkpathDest(node.file, canvasFile.path);
				if (!(resolvedFile instanceof TFile)) {
					continue;
				}

				if (NON_ATTACHMENT_EXTENSIONS.has(resolvedFile.extension.toLowerCase())) {
					continue;
				}

				referencedPaths.add(resolvedFile.path);
			}

			for (const referencedPath of referencedPaths) {
				const files = index.get(referencedPath);
				if (files) {
					files.push(canvasFile);
				} else {
					index.set(referencedPath, [canvasFile]);
				}
			}
		} catch {
			// Ignore malformed canvas content to avoid blocking the command.
		}
	}));

	for (const [targetPath, files] of index.entries()) {
		const dedupedFiles = Array.from(new Map(files.map((file) => [file.path, file])).values())
			.sort((left, right) => left.path.localeCompare(right.path));
		index.set(targetPath, dedupedFiles);
	}

	return index;
}

function parseOriginalReference(originalText: string): ParsedOriginalReference {
	const trimmed = originalText.trim();
	const wikiMatch = trimmed.match(WIKILINK_REGEX);
	if (wikiMatch) {
		const embed = wikiMatch[1] === '!';
		const inner = wikiMatch[2];
		const separatorIndex = inner.lastIndexOf('|');
		if (separatorIndex < 0) {
			return {
				embed,
				label: null,
				imageSize: null,
			};
		}

		const alias = inner.slice(separatorIndex + 1).trim();
		return {
			embed,
			label: alias || null,
			imageSize: IMAGE_SIZE_REGEX.test(alias) ? alias : null,
		};
	}

	const markdownMatch = trimmed.match(MARKDOWN_LINK_REGEX);
	if (markdownMatch) {
		const embed = markdownMatch[1] === '!';
		const label = markdownMatch[2].trim();
		return {
			embed,
			label: label || null,
			imageSize: extractMarkdownImageSize(label),
		};
	}

	return {
		embed: trimmed.startsWith('!'),
		label: null,
		imageSize: null,
	};
}

function extractMarkdownImageSize(label: string): string | null {
	const separatorIndex = label.lastIndexOf('|');
	if (separatorIndex < 0) {
		return null;
	}

	const sizePart = label.slice(separatorIndex + 1).trim();
	return IMAGE_SIZE_REGEX.test(sizePart) ? sizePart : null;
}

function buildReplacementOperations(
	plan: AttachmentBatchPlan,
	resolvedLinks: Map<string, ResolvedEagleLink>,
): ReplacementOperation[] {
	return plan.targets
		.flatMap((target) => target.occurrences.map((occurrence) => {
			const resolvedLink = resolvedLinks.get(target.sourceFile.path);
			if (!resolvedLink) {
				throw new Error(`Missing resolved Eagle link for ${target.sourceFile.path}`);
			}

			return {
				startOffset: occurrence.startOffset,
				endOffset: occurrence.endOffset,
				originalText: occurrence.originalText,
				replacementText: buildReplacementText(occurrence, resolvedLink),
			};
		}))
		.sort((left, right) => right.startOffset - left.startOffset);
}

function buildReplacementText(occurrence: AttachmentOccurrence, resolvedLink: ResolvedEagleLink): string {
	const { embed, label, imageSize } = occurrence.parsedReference;

	if (embed) {
		if (resolvedLink.isImage) {
			const imageLabel = imageSize
				? `${resolvedLink.fileName}|${imageSize}`
				: resolvedLink.fileName;
			return `![${escapeMarkdownLabel(imageLabel)}](${resolvedLink.url})`;
		}

		return `![${escapeMarkdownLabel(label || resolvedLink.fileName)}](${resolvedLink.url})`;
	}

	return `[${escapeMarkdownLabel(label || resolvedLink.fileName)}](${resolvedLink.url})`;
}

function applyReplacementOperations(content: string, replacements: ReplacementOperation[]): string {
	let nextContent = content;
	for (const replacement of replacements) {
		const currentText = nextContent.slice(replacement.startOffset, replacement.endOffset);
		if (currentText !== replacement.originalText) {
			throw new Error('REPLACEMENT_MISMATCH');
		}

		nextContent = `${nextContent.slice(0, replacement.startOffset)}${replacement.replacementText}${nextContent.slice(replacement.endOffset)}`;
	}

	return nextContent;
}

function canDeleteOriginalAttachment(target: AttachmentTargetPlan): boolean {
	return !target.sourceAlreadyInEagleLibrary
		&& target.otherMarkdownReferences.length === 0
		&& target.otherCanvasReferences.length === 0
		&& target.remainingCurrentReferences === 0;
}

function looksLikeAttachmentReference(originalText: string): boolean {
	const trimmed = originalText.trim();
	return WIKILINK_REGEX.test(trimmed) || MARKDOWN_LINK_REGEX.test(trimmed);
}

function escapeMarkdownLabel(label: string): string {
	return label
		.replace(/\\/g, '\\\\')
		.replace(/\]/g, '\\]')
		.replace(/\r?\n/g, ' ')
		.trim();
}

function buildCompletionMessage(stats: UploadExecutionStats): string {
	const parts = [
		`已替换 ${stats.replacedCount} 处附件引用`,
	];

	if (stats.uploadedCount > 0) {
		parts.push(`上传 ${stats.uploadedCount} 个附件到 Eagle`);
	}

	if (stats.reusedCount > 0) {
		parts.push(`复用 ${stats.reusedCount} 个已在 Eagle 库中的附件`);
	}

	if (stats.deletedCount > 0) {
		parts.push(`移入回收站 ${stats.deletedCount} 个原附件`);
	}

	if (stats.skippedDeletionCount > 0) {
		if (stats.retainedByReferenceCount > 0) {
			parts.push(`${stats.retainedByReferenceCount} 个原附件因仍被其他文件引用而保留`);
		}

		const otherRetainedCount = stats.skippedDeletionCount - stats.retainedByReferenceCount;
		if (otherRetainedCount > 0) {
			parts.push(`${otherRetainedCount} 个原附件因删除不安全而保留`);
		}

		parts.push('已生成可复制提示');
	}

	if (stats.deletedCount === 0 && stats.skippedDeletionCount === 0) {
		parts.push('未删除原附件');
	}

	return `${parts.join('，')}。`;
}

function buildDeletionReportText(activeFile: TFile, skips: DeletionSkipInfo[]): string {
	const lines = [
		`当前文档：${activeFile.path}`,
		'以下原附件未自动删除。',
		'如果这些附件仍被其他文件引用，请继续保留；如果后续确认不再需要，可以根据下面的清单手动删除。',
		'',
	];

	for (const skip of skips) {
		lines.push(`附件：${skip.sourceFile.path}`);

		if (skip.sourceAlreadyInEagleLibrary) {
			lines.push('原因：源文件已经位于 Eagle 库中，为避免误删 Eagle 原文件，已跳过自动删除。');
		}

		if (skip.remainingCurrentReferences > 0) {
			lines.push(`原因：当前文档中仍有 ${skip.remainingCurrentReferences} 处未替换的内部引用，已跳过自动删除。`);
		}

		if (skip.otherMarkdownReferences.length > 0) {
			lines.push('未删除原因：该附件仍被以下 Markdown 文件引用。');
			for (const referenceFile of skip.otherMarkdownReferences) {
				lines.push(`- ${referenceFile.path}`);
			}
		}

		if (skip.otherCanvasReferences.length > 0) {
			lines.push('未删除原因：该附件仍被以下 Canvas 文件引用。');
			for (const referenceFile of skip.otherCanvasReferences) {
				lines.push(`- ${referenceFile.path}`);
			}
		}

		if (skip.deletionError) {
			lines.push(`自动删除失败：${skip.deletionError}`);
		}

		lines.push('');
	}

	return lines.join('\n').trim();
}

class AttachmentDeletionReportModal extends Modal {
	private readonly reportText: string;

	constructor(app: App, reportText: string) {
		super(app);
		this.reportText = reportText;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: '原附件未自动删除警告' });
		contentEl.createEl('p', {
			text: '这些附件已被保留。请先根据引用关系判断是继续保留还是后续手动删除。',
		});

		const reportEl = contentEl.createEl('textarea');
		reportEl.value = this.reportText;
		reportEl.readOnly = true;
		reportEl.rows = 18;
		reportEl.style.width = '100%';
		reportEl.style.minHeight = '320px';
		reportEl.style.fontFamily = 'var(--font-monospace)';
		reportEl.style.resize = 'vertical';

		new Setting(contentEl)
			.addButton((button) => {
				button
					.setButtonText('复制提示')
					.setCta()
					.onClick(() => {
						void copyTextToClipboard(this.reportText).then((copied) => {
							new Notice(copied ? '提示已复制。' : '复制失败，请手动复制。');
						});
					});
			})
			.addButton((button) => {
				button
					.setButtonText('复制并关闭')
					.onClick(() => {
						void copyTextToClipboard(this.reportText).then((copied) => {
							new Notice(copied ? '提示已复制。' : '复制失败，请手动复制。');
							this.close();
						});
					});
			})
			.addButton((button) => {
				button
					.setButtonText('关闭')
					.onClick(() => {
						this.close();
					});
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

async function copyTextToClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}
