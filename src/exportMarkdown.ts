import { FileSystemAdapter, Modal, Notice, Platform, Setting, TFile } from 'obsidian';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import type MyPlugin from './main';
import type { MarkdownExportFormat } from './setting';

const execFileAsync = promisify(execFile);
const EAGLE_MARKDOWN_LINK_REGEX = /(!?)\[([^\]]*)\]\((http:\/\/localhost:\d+\/images\/([^)\/\s]+)\.info)([^)]*)\)/g;
const DEFAULT_EXPORT_SUFFIX = '-export';
const ATTACHMENT_DIR_NAME = 'attachment';
const POWER_SHELL_COMMAND = process.platform === 'win32' ? 'powershell.exe' : 'powershell';
const electron = require('electron');

interface EagleMarkdownLinkMatch {
	fullMatch: string;
	index: number;
	length: number;
	prefix: string;
	label: string;
	itemId: string;
	suffix: string;
}

interface ResolvedEagleItem {
	itemId: string;
	exportBaseName: string;
	sourceFilePath?: string;
	externalUrl?: string;
}

interface PreparedExportAsset {
	itemId: string;
	fileName: string;
	sourceFilePath: string;
}

interface PreparedMarkdownExport {
	markdown: string;
	assets: PreparedExportAsset[];
	convertedCount: number;
	unresolvedCount: number;
	externalUrlCount: number;
}

interface ExportSummary extends PreparedMarkdownExport {
	outputPath: string;
	format: MarkdownExportFormat;
}

interface DialogBridge {
	dialog: {
		showOpenDialog: (...args: unknown[]) => Promise<{ canceled: boolean; filePaths: string[] }>;
		showSaveDialog: (...args: unknown[]) => Promise<{ canceled: boolean; filePath?: string }>;
	};
	ownerWindow?: unknown;
}

export function registerMarkdownExportFileMenu(plugin: MyPlugin): void {
	plugin.registerEvent(
		plugin.app.workspace.on('file-menu', (menu, file) => {
			if (!Platform.isDesktopApp || !(file instanceof TFile) || file.extension !== 'md') {
				return;
			}

			menu.addItem((item) =>
				item
					.setIcon('download')
					.setTitle('Export Markdown with Eagle attachments')
					.onClick(() => {
						new ExportMarkdownModal(plugin, file).open();
					}),
			);
		}),
	);
}

class ExportMarkdownModal extends Modal {
	private readonly plugin: MyPlugin;
	private readonly file: TFile;
	private format: MarkdownExportFormat;
	private destinationPath: string;
	private destinationInputEl: HTMLInputElement | null = null;
	private exportButtonEl: HTMLButtonElement | null = null;
	private isExporting = false;

	constructor(plugin: MyPlugin, file: TFile) {
		super(plugin.app);
		this.plugin = plugin;
		this.file = file;
		this.format = plugin.settings.markdownExportFormat || 'folder';
		this.destinationPath = getInitialDestinationPath(plugin, file, this.format);
	}

	onOpen(): void {
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Export Markdown with Eagle attachments' });
		contentEl.createEl('p', {
			text: 'Create a shareable Markdown package and rewrite Eagle localhost links into relative attachment paths.',
		});

		new Setting(contentEl)
			.setName('Source note')
			.setDesc(this.file.path);

		new Setting(contentEl)
			.setName('Package format')
			.setDesc('Folder keeps plain files. ZIP creates a compressed package with the same structure.')
			.addDropdown((dropdown) => {
				dropdown
					.addOption('folder', 'Folder')
					.addOption('zip', 'ZIP')
					.setValue(this.format)
					.onChange((value: MarkdownExportFormat) => {
						this.format = value;
						this.destinationPath = coerceDestinationPath(this.destinationPath, this.file, value);
						this.render();
					});
			});

		new Setting(contentEl)
			.setName('Destination path')
			.setDesc(this.format === 'folder' ? 'Final export folder path.' : 'Final ZIP file path.')
			.addText((text) => {
				text
					.setPlaceholder(this.format === 'folder' ? 'Enter export folder path' : 'Enter export zip path')
					.setValue(this.destinationPath)
					.onChange((value) => {
						this.destinationPath = value.trim();
					});
				text.inputEl.style.width = '100%';
				this.destinationInputEl = text.inputEl;
			})
			.addExtraButton((button) => {
				button
					.setIcon('folder-open')
					.setTooltip(getDialogBridge() ? 'Browse destination' : 'Native picker unavailable, enter path manually')
					.setDisabled(!getDialogBridge())
					.onClick(() => {
						void this.browseDestination();
					});
			});

		new Setting(contentEl)
			.setName('Export')
			.setDesc(`The exported package will contain ${sanitizeFileName(this.file.name)} and ${ATTACHMENT_DIR_NAME}/.`)
			.addButton((button) => {
				button
					.setButtonText(this.isExporting ? 'Exporting...' : 'Export')
					.setCta()
					.setDisabled(this.isExporting)
					.onClick(() => {
						void this.handleExport();
					});
				this.exportButtonEl = button.buttonEl;
			});
	}

	private async browseDestination(): Promise<void> {
		const dialogBridge = getDialogBridge();
		if (!dialogBridge) {
			new Notice('Native file picker unavailable. Enter the export path manually.');
			return;
		}

		if (this.format === 'folder') {
			const result = await showOpenDirectoryDialog(dialogBridge, {
				defaultPath: getExistingParentPath(this.destinationPath) || path.join(os.homedir(), 'Downloads'),
				properties: ['openDirectory', 'createDirectory'],
				title: 'Choose export parent folder',
			});

			if (result.canceled || result.filePaths.length === 0) {
				return;
			}

			this.destinationPath = path.join(result.filePaths[0], buildExportRootName(this.file));
			this.updateDestinationInput();
			return;
		}

		const result = await showSaveDialog(dialogBridge, {
			defaultPath: ensureZipExtension(this.destinationPath),
			filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
			title: 'Choose export zip path',
		});

		if (result.canceled || !result.filePath) {
			return;
		}

		this.destinationPath = ensureZipExtension(result.filePath);
		this.updateDestinationInput();
	}

	private updateDestinationInput(): void {
		if (this.destinationInputEl) {
			this.destinationInputEl.value = this.destinationPath;
		}
	}

	private async handleExport(): Promise<void> {
		if (this.isExporting) {
			return;
		}

		const destinationPath = this.destinationPath.trim();
		if (!destinationPath) {
			new Notice('Enter an export path before exporting.');
			return;
		}

		this.isExporting = true;
		if (this.exportButtonEl) {
			this.exportButtonEl.textContent = 'Exporting...';
			this.exportButtonEl.disabled = true;
		}

		try {
			const summary = await exportMarkdownWithEagleAttachments(this.plugin, this.file, {
				format: this.format,
				destinationPath,
			});

			this.plugin.settings.markdownExportFormat = this.format;
			this.plugin.settings.markdownExportDestinationPath = destinationPath;
			await this.plugin.saveSettings();

			const unresolvedSuffix = summary.unresolvedCount > 0
				? ` ${summary.unresolvedCount} link(s) stayed unchanged because the source file could not be resolved.`
				: '';
			const externalSuffix = summary.externalUrlCount > 0
				? ` ${summary.externalUrlCount} website link(s) were converted to direct URLs.`
				: '';
			new Notice(
				`Exported ${summary.convertedCount} Eagle link(s) to ${summary.format === 'zip' ? 'ZIP' : 'folder'}: ${summary.outputPath}.${unresolvedSuffix}${externalSuffix}`,
				10000,
			);
			this.close();
		} catch (error) {
			new Notice(getExportErrorMessage(error), 10000);
		} finally {
			this.isExporting = false;
			if (this.exportButtonEl) {
				this.exportButtonEl.textContent = 'Export';
				this.exportButtonEl.disabled = false;
			}
		}
	}
}

async function exportMarkdownWithEagleAttachments(
	plugin: MyPlugin,
	file: TFile,
	options: { format: MarkdownExportFormat; destinationPath: string },
): Promise<ExportSummary> {
	if (!(plugin.app.vault.adapter instanceof FileSystemAdapter)) {
		throw new Error('FILESYSTEM_ADAPTER_REQUIRED');
	}

	const prepared = await prepareMarkdownExport(plugin, file);

	if (options.format === 'folder') {
		const outputPath = await ensureAvailableOutputPath(path.resolve(options.destinationPath), 'folder');
		await writeBundleToFolder(prepared, file, outputPath);
		return {
			...prepared,
			outputPath,
			format: 'folder',
		};
	}

	const outputPath = await ensureAvailableOutputPath(ensureZipExtension(path.resolve(options.destinationPath)), 'zip');
	await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

	const tempRoot = path.join(os.tmpdir(), `eaglebridge-export-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	const tempExportFolder = path.join(tempRoot, buildExportRootName(file));

	try {
		await writeBundleToFolder(prepared, file, tempExportFolder);
		await createZipArchive(tempExportFolder, outputPath);
	} finally {
		await safeRemove(tempRoot);
	}

	return {
		...prepared,
		outputPath,
		format: 'zip',
	};
}

async function prepareMarkdownExport(plugin: MyPlugin, file: TFile): Promise<PreparedMarkdownExport> {
	const content = await plugin.app.vault.read(file);
	const matches = collectMarkdownLinkMatches(content);
	if (matches.length === 0) {
		return {
			markdown: content,
			assets: [],
			convertedCount: 0,
			unresolvedCount: 0,
			externalUrlCount: 0,
		};
	}

	if (!plugin.settings.libraryPath) {
		throw new Error('EAGLE_LIBRARY_PATH_NOT_SET');
	}

	const itemIds = Array.from(new Set(matches.map((match) => match.itemId)));
	const resolvedPairs = await Promise.all(itemIds.map(async (itemId) => {
		const resolvedItem = await resolveEagleItem(itemId, plugin.settings.libraryPath);
		return [itemId, resolvedItem] as [string, ResolvedEagleItem | null];
	}));

	const resolvedItems = new Map<string, ResolvedEagleItem | null>(resolvedPairs);
	const assetsByItemId = new Map<string, PreparedExportAsset>();
	const usedFileNames = new Set<string>();
	let convertedCount = 0;
	let unresolvedCount = 0;
	let externalUrlCount = 0;
	let cursor = 0;
	let transformedMarkdown = '';

	for (const match of matches) {
		transformedMarkdown += content.slice(cursor, match.index);
		cursor = match.index + match.length;

		const resolvedItem = resolvedItems.get(match.itemId);
		if (!resolvedItem) {
			unresolvedCount += 1;
			transformedMarkdown += match.fullMatch;
			continue;
		}

		let destination = '';
		if (resolvedItem.externalUrl) {
			destination = resolvedItem.externalUrl;
			externalUrlCount += 1;
		} else if (resolvedItem.sourceFilePath) {
			let asset = assetsByItemId.get(match.itemId);
			if (!asset) {
				const fileName = allocateUniqueFileName(resolvedItem.exportBaseName, usedFileNames);
				asset = {
					itemId: match.itemId,
					fileName,
					sourceFilePath: resolvedItem.sourceFilePath,
				};
				assetsByItemId.set(match.itemId, asset);
			}
			destination = formatMarkdownDestination(path.posix.join(ATTACHMENT_DIR_NAME, asset.fileName));
		} else {
			unresolvedCount += 1;
			transformedMarkdown += match.fullMatch;
			continue;
		}

		const label = match.label.trim().length > 0 ? match.label : resolvedItem.exportBaseName;
		transformedMarkdown += `${match.prefix}[${label}](${destination}${match.suffix})`;
		convertedCount += 1;
	}

	transformedMarkdown += content.slice(cursor);

	return {
		markdown: transformedMarkdown,
		assets: Array.from(assetsByItemId.values()),
		convertedCount,
		unresolvedCount,
		externalUrlCount,
	};
}

function collectMarkdownLinkMatches(content: string): EagleMarkdownLinkMatch[] {
	const matches: EagleMarkdownLinkMatch[] = [];
	let match: RegExpExecArray | null;

	while ((match = EAGLE_MARKDOWN_LINK_REGEX.exec(content)) !== null) {
		matches.push({
			fullMatch: match[0],
			index: match.index,
			length: match[0].length,
			prefix: match[1] || '',
			label: match[2] || '',
			itemId: match[4] || '',
			suffix: match[5] || '',
		});
	}

	EAGLE_MARKDOWN_LINK_REGEX.lastIndex = 0;
	return matches;
}

async function resolveEagleItem(itemId: string, libraryPath: string): Promise<ResolvedEagleItem | null> {
	const infoDirPath = path.join(path.resolve(libraryPath), 'images', `${itemId}.info`);
	const metadataPath = path.join(infoDirPath, 'metadata.json');

	if (!(await pathExists(metadataPath))) {
		return null;
	}

	let metadata: { name?: string; ext?: string } = {};
	try {
		metadata = JSON.parse(await fs.promises.readFile(metadataPath, 'utf8'));
	} catch {
		return null;
	}

	const rawName = normalizeMetadataPart(metadata.name) || itemId;
	const rawExt = normalizeMetadataPart(metadata.ext);
	const exportBaseName = sanitizeFileName(rawExt ? `${rawName}.${rawExt}` : rawName) || itemId;
	const expectedFilePath = rawExt
		? path.join(infoDirPath, `${rawName}.${rawExt}`)
		: path.join(infoDirPath, rawName);

	if (rawExt?.toLowerCase() === 'url') {
		const targetUrl = await readShortcutUrl(expectedFilePath);
		if (targetUrl) {
			return {
				itemId,
				exportBaseName,
				externalUrl: targetUrl,
			};
		}
	}

	const sourceFilePath = await resolveSourceFilePath(infoDirPath, expectedFilePath, rawName, rawExt);
	if (!sourceFilePath) {
		return null;
	}

	return {
		itemId,
		exportBaseName: sanitizeFileName(path.basename(sourceFilePath)) || exportBaseName,
		sourceFilePath,
	};
}

async function resolveSourceFilePath(
	infoDirPath: string,
	expectedFilePath: string,
	rawName: string,
	rawExt?: string,
): Promise<string | null> {
	if (await pathExists(expectedFilePath)) {
		return expectedFilePath;
	}

	const dirEntries = await fs.promises.readdir(infoDirPath, { withFileTypes: true });
	const fileEntries = dirEntries.filter((entry) => entry.isFile() && entry.name.toLowerCase() !== 'metadata.json');
	if (fileEntries.length === 0) {
		return null;
	}

	const exactNameMatch = fileEntries.find((entry) => entry.name.toLowerCase() === path.basename(expectedFilePath).toLowerCase());
	if (exactNameMatch) {
		return path.join(infoDirPath, exactNameMatch.name);
	}

	if (rawExt) {
		const extMatch = fileEntries.find((entry) => path.extname(entry.name).toLowerCase() === `.${rawExt.toLowerCase()}`);
		if (extMatch) {
			return path.join(infoDirPath, extMatch.name);
		}
	}

	const nameMatch = fileEntries.find((entry) => path.basename(entry.name, path.extname(entry.name)).toLowerCase() === rawName.toLowerCase());
	if (nameMatch) {
		return path.join(infoDirPath, nameMatch.name);
	}

	const sizedEntries = await Promise.all(fileEntries.map(async (entry) => ({
		name: entry.name,
		stats: await fs.promises.stat(path.join(infoDirPath, entry.name)),
	})));

	sizedEntries.sort((left, right) => right.stats.size - left.stats.size);
	return sizedEntries.length > 0 ? path.join(infoDirPath, sizedEntries[0].name) : null;
}

async function readShortcutUrl(filePath: string): Promise<string | null> {
	if (!(await pathExists(filePath))) {
		return null;
	}

	try {
		const content = await fs.promises.readFile(filePath, 'utf8');
		const match = content.match(/URL=(.+)/i);
		return match?.[1]?.trim() || null;
	} catch {
		return null;
	}
}

async function writeBundleToFolder(bundle: PreparedMarkdownExport, file: TFile, outputFolderPath: string): Promise<void> {
	await fs.promises.mkdir(outputFolderPath, { recursive: true });

	const markdownFileName = sanitizeFileName(file.name) || `${sanitizeFileName(file.basename) || 'export'}.md`;
	await fs.promises.writeFile(path.join(outputFolderPath, markdownFileName), bundle.markdown, 'utf8');

	if (bundle.assets.length === 0) {
		return;
	}

	const attachmentDirPath = path.join(outputFolderPath, ATTACHMENT_DIR_NAME);
	await fs.promises.mkdir(attachmentDirPath, { recursive: true });

	await Promise.all(bundle.assets.map((asset) =>
		fs.promises.copyFile(asset.sourceFilePath, path.join(attachmentDirPath, asset.fileName)),
	));
}

async function createZipArchive(sourceFolderPath: string, outputZipPath: string): Promise<void> {
	if (process.platform === 'win32') {
		await execFileAsync(POWER_SHELL_COMMAND, [
			'-NoProfile',
			'-Command',
			`Compress-Archive -LiteralPath '${escapePowerShellLiteral(sourceFolderPath)}' -DestinationPath '${escapePowerShellLiteral(outputZipPath)}' -Force`,
		]);
		return;
	}

	if (process.platform === 'darwin') {
		await execFileAsync('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', sourceFolderPath, outputZipPath]);
		return;
	}

	await execFileAsync('zip', ['-r', '-q', outputZipPath, path.basename(sourceFolderPath)], {
		cwd: path.dirname(sourceFolderPath),
	});
}

async function ensureAvailableOutputPath(targetPath: string, format: MarkdownExportFormat): Promise<string> {
	const resolvedTargetPath = path.resolve(targetPath);
	if (!(await pathExists(resolvedTargetPath))) {
		return resolvedTargetPath;
	}

	if (format === 'folder') {
		const stats = await fs.promises.stat(resolvedTargetPath);
		if (stats.isDirectory()) {
			const entries = await fs.promises.readdir(resolvedTargetPath);
			if (entries.length === 0) {
				return resolvedTargetPath;
			}
		}
	}

	const parsedPath = path.parse(resolvedTargetPath);
	const baseName = format === 'folder' ? parsedPath.base : parsedPath.name;
	const extension = format === 'folder' ? '' : parsedPath.ext || '.zip';

	for (let suffix = 2; suffix < 1000; suffix += 1) {
		const candidatePath = path.join(parsedPath.dir, `${baseName}-${suffix}${extension}`);
		if (!(await pathExists(candidatePath))) {
			return candidatePath;
		}
	}

	throw new Error('EXPORT_PATH_UNAVAILABLE');
}

function getInitialDestinationPath(plugin: MyPlugin, file: TFile, format: MarkdownExportFormat): string {
	const storedPath = plugin.settings.markdownExportDestinationPath?.trim();
	if (storedPath) {
		return coerceDestinationPath(storedPath, file, format);
	}

	const downloadDirPath = path.join(os.homedir(), 'Downloads');
	return coerceDestinationPath(path.join(downloadDirPath, buildExportRootName(file)), file, format);
}

function coerceDestinationPath(currentPath: string, file: TFile, format: MarkdownExportFormat): string {
	const normalizedPath = currentPath.trim();
	if (!normalizedPath) {
		const defaultPath = path.join(os.homedir(), 'Downloads', buildExportRootName(file));
		return format === 'zip' ? ensureZipExtension(defaultPath) : defaultPath;
	}

	if (format === 'zip') {
		return ensureZipExtension(normalizedPath);
	}

	const parsedPath = path.parse(normalizedPath);
	return parsedPath.ext.toLowerCase() === '.zip'
		? path.join(parsedPath.dir, parsedPath.name)
		: normalizedPath;
}

function buildExportRootName(file: TFile): string {
	const baseName = sanitizeFileName(file.basename) || 'export';
	return `${baseName}${DEFAULT_EXPORT_SUFFIX}`;
}

function allocateUniqueFileName(preferredFileName: string, usedFileNames: Set<string>): string {
	const safeFileName = sanitizeFileName(preferredFileName) || 'attachment';
	const parsedFileName = path.parse(safeFileName);
	const normalizedBaseName = parsedFileName.name || 'attachment';
	const normalizedExtension = parsedFileName.ext;

	let candidate = safeFileName;
	let suffix = 2;
	while (usedFileNames.has(candidate.toLowerCase())) {
		candidate = `${normalizedBaseName}-${suffix}${normalizedExtension}`;
		suffix += 1;
	}

	usedFileNames.add(candidate.toLowerCase());
	return candidate;
}

function sanitizeFileName(fileName: string): string {
	const parsedFileName = path.parse(fileName);
	const safeName = sanitizePathSegment(parsedFileName.name) || 'file';
	const safeExtension = sanitizePathSegment(parsedFileName.ext.replace(/^\./, ''));
	return safeExtension ? `${safeName}.${safeExtension}` : safeName;
}

function sanitizePathSegment(value: string): string {
	return value
		.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/[. ]+$/g, '');
}

function formatMarkdownDestination(relativePath: string): string {
	return /[\s()]/.test(relativePath) ? `<${relativePath}>` : relativePath;
}

function normalizeMetadataPart(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}

	const trimmedValue = value.trim();
	return trimmedValue.length > 0 ? trimmedValue : undefined;
}

function ensureZipExtension(targetPath: string): string {
	return targetPath.toLowerCase().endsWith('.zip') ? targetPath : `${targetPath}.zip`;
}

function escapePowerShellLiteral(value: string): string {
	return value.replace(/'/g, "''");
}

async function pathExists(targetPath: string): Promise<boolean> {
	try {
		await fs.promises.access(targetPath, fs.constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function safeRemove(targetPath: string): Promise<void> {
	if (!(await pathExists(targetPath))) {
		return;
	}

	await fs.promises.rm(targetPath, { force: true, recursive: true });
}

function getExistingParentPath(targetPath: string): string {
	let currentPath = path.resolve(targetPath || os.homedir());
	while (true) {
		if (fs.existsSync(currentPath)) {
			return currentPath;
		}

		const parentPath = path.dirname(currentPath);
		if (parentPath === currentPath) {
			return os.homedir();
		}
		currentPath = parentPath;
	}
}

function getDialogBridge(): DialogBridge | null {
	const directDialog = electron?.dialog;
	if (directDialog?.showOpenDialog && directDialog?.showSaveDialog) {
		return {
			dialog: directDialog,
			ownerWindow: electron.BrowserWindow?.getFocusedWindow?.(),
		};
	}

	const remoteDialog = electron?.remote?.dialog;
	if (remoteDialog?.showOpenDialog && remoteDialog?.showSaveDialog) {
		return {
			dialog: remoteDialog,
			ownerWindow: electron.remote.BrowserWindow?.getFocusedWindow?.(),
		};
	}

	try {
		const remoteModule = require('@electron/remote');
		if (remoteModule?.dialog?.showOpenDialog && remoteModule?.dialog?.showSaveDialog) {
			return {
				dialog: remoteModule.dialog,
				ownerWindow: remoteModule.getCurrentWindow?.(),
			};
		}
	} catch {
		return null;
	}

	return null;
}

async function showOpenDirectoryDialog(
	dialogBridge: DialogBridge,
	options: Record<string, unknown>,
): Promise<{ canceled: boolean; filePaths: string[] }> {
	if (dialogBridge.ownerWindow) {
		return dialogBridge.dialog.showOpenDialog(dialogBridge.ownerWindow, options);
	}

	return dialogBridge.dialog.showOpenDialog(options);
}

async function showSaveDialog(
	dialogBridge: DialogBridge,
	options: Record<string, unknown>,
): Promise<{ canceled: boolean; filePath?: string }> {
	if (dialogBridge.ownerWindow) {
		return dialogBridge.dialog.showSaveDialog(dialogBridge.ownerWindow, options);
	}

	return dialogBridge.dialog.showSaveDialog(options);
}

function getExportErrorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);

	switch (message) {
		case 'EAGLE_LIBRARY_PATH_NOT_SET':
			return 'Set Eagle Library Path before exporting notes that contain Eagle attachments.';
		case 'FILESYSTEM_ADAPTER_REQUIRED':
			return 'Markdown export is only available in desktop vaults backed by the file system.';
		case 'EXPORT_PATH_UNAVAILABLE':
			return 'Could not allocate a free export path. Try another destination.';
		default:
			return `Export failed: ${message}`;
	}
}
