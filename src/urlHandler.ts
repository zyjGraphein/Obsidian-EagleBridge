import { Editor, Notice } from 'obsidian';
import { EditorView } from '@codemirror/view';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type MyPlugin from './main';
import { print } from './main';
import {
	buildLibraryItemUrl,
	findLibraryProfileByFilePath,
	getEnabledResolvedLibraryProfiles,
	getFixedUploadTargetProfile,
	getLibraryItemPathForProfile,
	hasAnyResolvedUploadTarget,
	type ResolvedEagleLibraryProfile,
} from './libraryProfiles';
import { getCurrentPageTags } from './synchronizedpagetabs';
import { chooseUploadTargetProfile } from './uploadTargetModal';
import { uploadFileToLibrary, uploadUrlToLibrary } from './eagleApi';

const electron = require('electron');
const IMAGE_EXTENSIONS = new Set([
	'.png',
	'.jpg',
	'.jpeg',
	'.gif',
	'.webp',
	'.svg',
	'.avif',
	'.bmp',
	'.ico',
]);
const VIDEO_EXTENSIONS = new Set([
	'.mp4',
	'.mov',
	'.avi',
	'.mkv',
	'.webm',
	'.m4v',
	'.wmv',
	'.flv',
	'.mpeg',
	'.mpg',
	'.3gp',
]);

export type UploadSurface = 'markdown' | 'canvas';
type UploadContentType = 'image' | 'video' | 'website' | 'other';
export type MarkdownTransferKind = 'paste' | 'drop';

export interface ResolvedEagleLink {
	url: string;
	fileName: string;
	isImage: boolean;
	port: number;
	profileId: string;
}

export function getNativeTransferFilePath(file: File): string | null {
	const filePath = electron.webUtils.getPathForFile(file);
	return typeof filePath === 'string' && filePath.length > 0 ? filePath : null;
}

function normalizeTransferPath(filePath: string): string {
	const normalizedPath = path.normalize(path.resolve(filePath)).replace(/[\\/]+$/, '');
	return process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
}

function getTransferFileKey(file: File): string {
	const nativeFilePath = getNativeTransferFilePath(file);
	if (nativeFilePath) {
		return `path:${normalizeTransferPath(nativeFilePath)}`;
	}

	return `meta:${file.name}:${file.size}:${file.type}:${file.lastModified}`;
}

function getTransferFilePreferenceScore(file: File, pluginInstance?: MyPlugin): number {
	const filePath = getNativeTransferFilePath(file);
	if (!filePath) {
		return 0;
	}

	if (!pluginInstance) {
		return 1;
	}

	return findLibraryProfileByFilePath(pluginInstance.settings, filePath) ? 2 : 1;
}

function pickPreferredTransferFile(existingFile: File, nextFile: File, pluginInstance?: MyPlugin): File {
	const existingScore = getTransferFilePreferenceScore(existingFile, pluginInstance);
	const nextScore = getTransferFilePreferenceScore(nextFile, pluginInstance);
	return nextScore > existingScore ? nextFile : existingFile;
}

function getEditorView(editor: Editor): EditorView | null {
	const editorView = (editor as Editor & { cm?: EditorView }).cm;
	return editorView instanceof EditorView ? editorView : null;
}

function resolveEditorDropPosition(editor: Editor, dragEvent: DragEvent) {
	const editorView = getEditorView(editor);
	if (!editorView) {
		return null;
	}

	const dropOffset = editorView.posAtCoords({
		x: dragEvent.clientX,
		y: dragEvent.clientY,
	});

	if (typeof dropOffset !== 'number') {
		return null;
	}

	return editor.offsetToPos(dropOffset);
}

export function syncEditorCursorToDragEvent(editor: Editor, dragEvent: DragEvent): boolean {
	const dropPosition = resolveEditorDropPosition(editor, dragEvent);
	if (!dropPosition) {
		return false;
	}

	editor.setSelection(dropPosition, dropPosition);
	return true;
}

function consumeHandledEvent(event: Event): void {
	event.preventDefault();
	event.stopPropagation();
	event.stopImmediatePropagation();
}

export function getTransferFiles(
	dataTransfer: DataTransfer | null | undefined,
	pluginInstance?: MyPlugin,
): File[] {
	if (!dataTransfer) {
		return [];
	}

	const files = Array.from(dataTransfer.files ?? []);
	const itemFiles = Array.from(dataTransfer.items ?? [])
		.filter((item) => item.kind === 'file')
		.map((item) => item.getAsFile())
		.filter((file): file is File => Boolean(file));

	const mergedFiles = [...files, ...itemFiles];
	const dedupedFiles = new Map<string, File>();

	for (const file of mergedFiles) {
		const key = getTransferFileKey(file);
		const existingFile = dedupedFiles.get(key);
		if (!existingFile) {
			dedupedFiles.set(key, file);
			continue;
		}

		dedupedFiles.set(key, pickPreferredTransferFile(existingFile, file, pluginInstance));
	}

	return Array.from(dedupedFiles.values());
}

function isHttpUrl(value: string): boolean {
	return /^https?:\/\/[^\s]+$/i.test(value);
}

function isImageExtension(filePathOrExt: string): boolean {
	const normalizedExt = filePathOrExt.startsWith('.')
		? filePathOrExt.toLowerCase()
		: path.extname(filePathOrExt).toLowerCase();
	return IMAGE_EXTENSIONS.has(normalizedExt);
}

function getUploadContentType(fileName: string): UploadContentType {
	const normalizedExt = path.extname(fileName).toLowerCase();
	if (IMAGE_EXTENSIONS.has(normalizedExt)) {
		return 'image';
	}

	if (VIDEO_EXTENSIONS.has(normalizedExt)) {
		return 'video';
	}

	return 'other';
}

function isUploadSurfaceEnabled(surface: UploadSurface, pluginInstance: MyPlugin): boolean {
	if (!pluginInstance.settings.upload.enabled) {
		return false;
	}

	switch (surface) {
		case 'markdown':
			return pluginInstance.settings.upload.markdown;
		case 'canvas':
			return pluginInstance.settings.upload.canvas;
		default:
			return false;
	}
}

function isUploadContentEnabled(targetType: UploadContentType, pluginInstance: MyPlugin): boolean {
	switch (targetType) {
		case 'image':
			return pluginInstance.settings.upload.image;
		case 'video':
			return pluginInstance.settings.upload.video;
		case 'website':
			return pluginInstance.settings.upload.website;
		case 'other':
			return pluginInstance.settings.upload.other;
		default:
			return false;
	}
}

function shouldUploadTransferFile(file: File, pluginInstance: MyPlugin): boolean {
	return isUploadContentEnabled(getUploadContentType(file.name), pluginInstance);
}

function resolveTransferFileLibraryProfile(file: File, pluginInstance: MyPlugin): ResolvedEagleLibraryProfile | null {
	const filePath = getNativeTransferFilePath(file);
	if (!filePath) {
		return null;
	}

	return findLibraryProfileByFilePath(pluginInstance.settings, filePath);
}

function isTransferFileAlreadyInAnyEagleLibrary(file: File, pluginInstance: MyPlugin): boolean {
	return Boolean(resolveTransferFileLibraryProfile(file, pluginInstance));
}

function shouldConvertTransferFileToEagleLink(file: File, pluginInstance: MyPlugin, surface: UploadSurface): boolean {
	if (isTransferFileAlreadyInAnyEagleLibrary(file, pluginInstance)) {
		return true;
	}

	return isUploadSurfaceEnabled(surface, pluginInstance)
		&& hasAnyResolvedUploadTarget(pluginInstance.settings)
		&& shouldUploadTransferFile(file, pluginInstance);
}

export function shouldUploadTransferFiles(files: File[], pluginInstance: MyPlugin, surface: UploadSurface): boolean {
	return isUploadSurfaceEnabled(surface, pluginInstance)
		&& hasAnyResolvedUploadTarget(pluginInstance.settings)
		&& files.length > 0
		&& files.every((file) => !isTransferFileAlreadyInAnyEagleLibrary(file, pluginInstance))
		&& files.every((file) => shouldUploadTransferFile(file, pluginInstance));
}

export function shouldConvertTransferFilesToEagleLinks(files: File[], pluginInstance: MyPlugin, surface: UploadSurface): boolean {
	return files.length > 0
		&& files.every((file) => shouldConvertTransferFileToEagleLink(file, pluginInstance, surface));
}

export function shouldTrackMarkdownDragCursor(
	dragEvent: DragEvent,
	pluginInstance: MyPlugin,
): boolean {
	const dataTransfer = dragEvent.dataTransfer;
	if (!dataTransfer) {
		return false;
	}

	const transferFiles = getTransferFiles(dataTransfer, pluginInstance);
	return shouldConvertTransferFilesToEagleLinks(transferFiles, pluginInstance, 'markdown');
}

export function canResolveMarkdownTransfer(
	dataTransfer: DataTransfer | null | undefined,
	kind: MarkdownTransferKind,
	pluginInstance: MyPlugin,
): boolean {
	if (!dataTransfer) {
		return false;
	}

	const transferFiles = getTransferFiles(dataTransfer, pluginInstance);
	if (kind === 'drop') {
		return shouldConvertTransferFilesToEagleLinks(transferFiles, pluginInstance, 'markdown');
	}

	const clipboardText = dataTransfer.getData('text/plain')?.trim() || '';
	const shouldHandleFiles = shouldConvertTransferFilesToEagleLinks(transferFiles, pluginInstance, 'markdown');
	const shouldHandleUrl = Boolean(
		clipboardText
		&& isHttpUrl(clipboardText)
		&& !clipboardText.startsWith('http://localhost')
		&& shouldUploadExternalUrl(pluginInstance, 'markdown'),
	);
	return shouldHandleFiles || shouldHandleUrl;
}

export function shouldUploadExternalUrl(pluginInstance: MyPlugin, surface: UploadSurface): boolean {
	return isUploadSurfaceEnabled(surface, pluginInstance)
		&& hasAnyResolvedUploadTarget(pluginInstance.settings)
		&& isUploadContentEnabled('website', pluginInstance);
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

async function selectUploadTargetProfile(pluginInstance: MyPlugin): Promise<ResolvedEagleLibraryProfile> {
	const availableProfiles = getEnabledResolvedLibraryProfiles(pluginInstance.settings);
	if (availableProfiles.length === 0) {
		throw new Error('NO_UPLOAD_TARGET');
	}

	if (pluginInstance.settings.externalUploadMode === 'askEveryTime') {
		const chosenProfile = await chooseUploadTargetProfile(pluginInstance, availableProfiles);
		if (!chosenProfile) {
			throw new Error('UPLOAD_TARGET_CANCELLED');
		}
		return chosenProfile;
	}

	const fixedProfile = getFixedUploadTargetProfile(pluginInstance.settings);
	if (!fixedProfile) {
		throw new Error('NO_UPLOAD_TARGET');
	}

	return fixedProfile;
}

function buildLibraryLink(filePath: string, profile: ResolvedEagleLibraryProfile): ResolvedEagleLink {
	const itemPath = getLibraryItemPathForProfile(filePath, profile);
	if (!itemPath) {
		throw new Error('NON_EAGLE_FILE');
	}

	return {
		url: `http://localhost:${profile.servePort}/${itemPath}`,
		fileName: path.basename(filePath),
		isImage: isImageExtension(filePath),
		port: profile.servePort,
		profileId: profile.id,
	};
}

function createUploadedLink(profile: ResolvedEagleLibraryProfile, itemId: string, fileName: string): ResolvedEagleLink {
	return {
		url: buildLibraryItemUrl(profile.servePort, itemId),
		fileName,
		isImage: isImageExtension(fileName),
		port: profile.servePort,
		profileId: profile.id,
	};
}

export function createMarkdownLink(link: ResolvedEagleLink, imageSize: number | undefined): string {
	if (!link.isImage) {
		return `[${link.fileName}](${link.url})`;
	}

	const sizeSuffix = imageSize ? `|${imageSize}` : '';
	return `![${link.fileName}${sizeSuffix}](${link.url})`;
}

export async function getTransferFilePath(file: File): Promise<string> {
	let filePath = getNativeTransferFilePath(file);
	if (filePath) {
		return filePath;
	}

	const uploadDir = path.join(os.tmpdir(), 'obsidian-uploads');
	if (!fs.existsSync(uploadDir)) {
		fs.mkdirSync(uploadDir, { recursive: true });
	}

	filePath = path.join(uploadDir, file.name);
	const buffer = await file.arrayBuffer();
	fs.writeFileSync(filePath, Buffer.from(buffer));
	return filePath;
}

export async function resolveFilePathToEagleLink(
	filePath: string,
	pluginInstance: MyPlugin,
	preferredUploadTarget?: ResolvedEagleLibraryProfile | null,
): Promise<ResolvedEagleLink> {
	const existingProfile = findLibraryProfileByFilePath(pluginInstance.settings, filePath);
	if (existingProfile?.resolvedPath) {
		return buildLibraryLink(filePath, existingProfile);
	}

	const targetProfile = preferredUploadTarget ?? await selectUploadTargetProfile(pluginInstance);
	const tags = getCurrentPageTags(pluginInstance.app, pluginInstance.settings);
	const uploadedItem = await uploadFileToLibrary(filePath, targetProfile, tags);
	return createUploadedLink(
		targetProfile,
		uploadedItem.itemId,
		uploadedItem.sourceFileName || uploadedItem.expectedFileName || path.basename(filePath),
	);
}

export async function resolveUrlToEagleLink(
	url: string,
	pluginInstance: MyPlugin,
	preferredUploadTarget?: ResolvedEagleLibraryProfile | null,
): Promise<ResolvedEagleLink> {
	const targetProfile = preferredUploadTarget ?? await selectUploadTargetProfile(pluginInstance);
	const tags = getCurrentPageTags(pluginInstance.app, pluginInstance.settings);
	const uploadedItem = await uploadUrlToLibrary(url, targetProfile, tags);
	return createUploadedLink(
		targetProfile,
		uploadedItem.itemId,
		uploadedItem.sourceFileName || uploadedItem.expectedFileName || url,
	);
}

export async function resolveTransferFilesToEagleLinks(
	files: File[],
	pluginInstance: MyPlugin,
	surface: UploadSurface,
): Promise<ResolvedEagleLink[] | null> {
	if (!shouldConvertTransferFilesToEagleLinks(files, pluginInstance, surface)) {
		return null;
	}

	const filePaths = await Promise.all(files.map((file) => getTransferFilePath(file)));
	const uniqueFilePaths = new Map<string, string>();
	for (const filePath of filePaths) {
		const comparablePath = normalizeTransferPath(filePath);
		if (!uniqueFilePaths.has(comparablePath)) {
			uniqueFilePaths.set(comparablePath, filePath);
		}
	}

	const dedupedFilePaths = Array.from(uniqueFilePaths.values());
	if (dedupedFilePaths.length !== filePaths.length) {
		print(`Deduped transfer files from ${filePaths.length} to ${dedupedFilePaths.length}`);
	}

	const hasExternalFiles = dedupedFilePaths.some((filePath) => !findLibraryProfileByFilePath(pluginInstance.settings, filePath));
	const preferredUploadTarget = hasExternalFiles ? await selectUploadTargetProfile(pluginInstance) : null;
	const resolvedLinks: ResolvedEagleLink[] = [];

	for (const filePath of dedupedFilePaths) {
		resolvedLinks.push(await resolveFilePathToEagleLink(filePath, pluginInstance, preferredUploadTarget));
	}

	return resolvedLinks;
}

export async function resolveMarkdownTransfer(
	dataTransfer: DataTransfer | null | undefined,
	kind: MarkdownTransferKind,
	pluginInstance: MyPlugin,
): Promise<string[] | null> {
	if (!dataTransfer || !canResolveMarkdownTransfer(dataTransfer, kind, pluginInstance)) {
		return null;
	}

	if (kind === 'drop') {
		const transferFiles = getTransferFiles(dataTransfer, pluginInstance);
		const resolvedLinks = await resolveTransferFilesToEagleLinks(transferFiles, pluginInstance, 'markdown');
		return resolvedLinks?.map((link) => createMarkdownLink(link, pluginInstance.settings.imageSize)) ?? null;
	}

	const clipboardText = dataTransfer.getData('text/plain')?.trim() || '';
	const clipboardFiles = getTransferFiles(dataTransfer, pluginInstance);
	const shouldHandleFiles = shouldConvertTransferFilesToEagleLinks(clipboardFiles, pluginInstance, 'markdown');

	if (clipboardFiles.length > 0 && !shouldHandleFiles) {
		return null;
	}

	if (clipboardText && isHttpUrl(clipboardText) && !clipboardText.startsWith('http://localhost')) {
		if (!shouldUploadExternalUrl(pluginInstance, 'markdown')) {
			return null;
		}

		const resolvedLink = await resolveUrlToEagleLink(clipboardText, pluginInstance);
		return [createMarkdownLink(resolvedLink, pluginInstance.settings.imageSize)];
	}

	if (!shouldHandleFiles || clipboardFiles.length === 0) {
		return null;
	}

	const resolvedLinks = await resolveTransferFilesToEagleLinks(clipboardFiles, pluginInstance, 'markdown');
	return resolvedLinks?.map((link) => createMarkdownLink(link, pluginInstance.settings.imageSize)) ?? null;
}

export async function handlePasteEvent(
	clipboardEvent: ClipboardEvent,
	editor: Editor,
	_port: number,
	pluginInstance: MyPlugin,
) {
	if (clipboardEvent.defaultPrevented) {
		return;
	}

	const clipboardData = clipboardEvent.clipboardData;
	if (!canResolveMarkdownTransfer(clipboardData, 'paste', pluginInstance)) {
		return;
	}

	consumeHandledEvent(clipboardEvent);

	try {
		const embeds = await resolveMarkdownTransfer(clipboardData, 'paste', pluginInstance);
		if (!embeds || embeds.length === 0) {
			return;
		}

		editor.replaceSelection(embeds.join('\n'));
		const clipboardText = clipboardData?.getData('text/plain')?.trim() || '';
		if (clipboardText && isHttpUrl(clipboardText) && !clipboardText.startsWith('http://localhost')) {
			new Notice('URL uploaded successfully, please wait for Eagle link update', 12000);
			return;
		}
		new Notice('Eagle link converted');
	} catch (error) {
		const message = toErrorMessage(error);
		if (message === 'UPLOAD_TARGET_CANCELLED') {
			return;
		}
		if (message === 'NO_UPLOAD_TARGET') {
			new Notice('No available Eagle library profile for upload.');
			return;
		}
		if (message === 'NON_EAGLE_FILE') {
			new Notice('Non-Eagle link');
			return;
		}

		print(`File upload failed: ${message}`);
		new Notice('File upload failed, check if Eagle is running');
	}
}

export async function handleDropEvent(
	dropEvent: DragEvent,
	editor: Editor,
	_port: number,
	pluginInstance: MyPlugin,
) {
	if (dropEvent.defaultPrevented) {
		return;
	}

	if (!canResolveMarkdownTransfer(dropEvent.dataTransfer, 'drop', pluginInstance)) {
		return;
	}

	syncEditorCursorToDragEvent(editor, dropEvent);
	consumeHandledEvent(dropEvent);

	try {
		const embeds = await resolveMarkdownTransfer(dropEvent.dataTransfer, 'drop', pluginInstance);
		if (!embeds || embeds.length === 0) {
			return;
		}

		editor.replaceSelection(embeds.join('\n'));
		new Notice('Eagle link converted');
	} catch (error) {
		const message = toErrorMessage(error);
		if (message === 'UPLOAD_TARGET_CANCELLED') {
			return;
		}
		if (message === 'NO_UPLOAD_TARGET') {
			new Notice('No available Eagle library profile for upload.');
			return;
		}
		if (message === 'NON_EAGLE_FILE') {
			new Notice('Non-Eagle link');
			return;
		}

		print(`File upload failed: ${message}`);
		new Notice('File upload failed, check if Eagle is running');
	}
}
