import { Editor, Notice } from 'obsidian';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { urlEmitter } from './server';
import type MyPlugin from './main';
import { print } from './main';
import { getEagleLibraryItemPath, isPathInsideDirectory } from './eaglePaths';
import { getCurrentPageTags } from './synchronizedpagetabs';

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

export interface ResolvedEagleLink {
    url: string;
    fileName: string;
    isImage: boolean;
}

function consumeHandledEvent(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
}

export function getTransferFiles(dataTransfer: DataTransfer | null | undefined): File[] {
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
        const key = `${file.name}:${file.size}:${file.type}:${file.lastModified}`;
        if (!dedupedFiles.has(key)) {
            dedupedFiles.set(key, file);
        }
    }

    return Array.from(dedupedFiles.values());
}

function isHttpUrl(value: string): boolean {
    return /^https?:\/\/[^\s]+$/.test(value);
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

export function shouldUploadTransferFiles(files: File[], pluginInstance: MyPlugin, surface: UploadSurface): boolean {
    return isUploadSurfaceEnabled(surface, pluginInstance)
        && files.length > 0
        && files.every((file) => shouldUploadTransferFile(file, pluginInstance));
}

export function shouldUploadExternalUrl(pluginInstance: MyPlugin, surface: UploadSurface): boolean {
    return isUploadSurfaceEnabled(surface, pluginInstance)
        && isUploadContentEnabled('website', pluginInstance);
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

function waitForNextUrlUpdate(timeoutMs = 15000): Promise<string> {
    return new Promise((resolve, reject) => {
        const onUpdate = (latestDirUrl: string) => {
            clearTimeout(timer);
            resolve(latestDirUrl);
        };

        const timer = setTimeout(() => {
            urlEmitter.removeListener('urlUpdated', onUpdate);
            reject(new Error('URL_UPDATE_TIMEOUT'));
        }, timeoutMs);

        urlEmitter.once('urlUpdated', onUpdate);
    });
}

function buildLibraryLink(filePath: string, pluginInstance: MyPlugin): ResolvedEagleLink {
    const itemPath = getEagleLibraryItemPath(filePath, pluginInstance.settings.libraryPath);
    if (!itemPath) {
        throw new Error('NON_EAGLE_FILE');
    }

    return {
        url: `http://localhost:${pluginInstance.settings.port}/${itemPath}`,
        fileName: path.basename(filePath),
        isImage: isImageExtension(filePath),
    };
}

async function fetchUploadedItemFileName(latestDirUrl: string): Promise<string | null> {
    const match = latestDirUrl.match(/images\/([^/]+)\.info/);
    if (!match?.[1]) {
        return null;
    }

    await delay(2000);

    try {
        const response = await fetch(`http://localhost:41595/api/item/info?id=${match[1]}`, {
            method: 'GET',
            redirect: 'follow' as RequestRedirect,
        });
        const result = await response.json();

        if (result.status === 'success' && result.data) {
            return `${result.data.name}.${result.data.ext}`;
        }
    } catch (error) {
        print(`Request error: ${toErrorMessage(error)}`);
    }

    return null;
}

export function createMarkdownLink(link: ResolvedEagleLink, imageSize: number | undefined): string {
    if (!link.isImage) {
        return `[${link.fileName}](${link.url})`;
    }

    const sizeSuffix = imageSize ? `|${imageSize}` : '';
    return `![${link.fileName}${sizeSuffix}](${link.url})`;
}

export async function getTransferFilePath(file: File): Promise<string> {
    let filePath = electron.webUtils.getPathForFile(file);
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

export async function resolveFilePathToEagleLink(filePath: string, pluginInstance: MyPlugin): Promise<ResolvedEagleLink> {
    if (isPathInsideDirectory(filePath, pluginInstance.settings.libraryPath)) {
        return buildLibraryLink(filePath, pluginInstance);
    }

    const nextUrlPromise = waitForNextUrlUpdate();
    await uploadByClipboard(filePath, pluginInstance);
    const latestDirUrl = await nextUrlPromise;

    return {
        url: latestDirUrl,
        fileName: path.basename(filePath),
        isImage: isImageExtension(filePath),
    };
}

export async function resolveUrlToEagleLink(url: string, pluginInstance: MyPlugin): Promise<ResolvedEagleLink> {
    const nextUrlPromise = waitForNextUrlUpdate();
    await uploadByUrl(url, pluginInstance);
    const latestDirUrl = await nextUrlPromise;
    const fileName = await fetchUploadedItemFileName(latestDirUrl);

    return {
        url: latestDirUrl,
        fileName: fileName || url,
        isImage: fileName ? isImageExtension(fileName) : false,
    };
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
    const clipboardText = clipboardData?.getData('text/plain')?.trim() || '';
    const clipboardFiles = getTransferFiles(clipboardData);
    const shouldHandleFiles = shouldUploadTransferFiles(clipboardFiles, pluginInstance, 'markdown');
    const shouldHandleUrl = Boolean(
        clipboardText &&
        isHttpUrl(clipboardText) &&
        !clipboardText.startsWith('http://localhost') &&
        shouldUploadExternalUrl(pluginInstance, 'markdown')
    );

    if (shouldHandleFiles || shouldHandleUrl) {
        consumeHandledEvent(clipboardEvent);
    }

    let filePath = '';

    if (clipboardFiles.length > 0 && !shouldHandleFiles) {
        return;
    }

    if (shouldHandleFiles) {
        filePath = await getTransferFilePath(clipboardFiles[0]);
    }

    if (clipboardText && isHttpUrl(clipboardText) && !clipboardText.startsWith('http://localhost')) {
        if (!shouldUploadExternalUrl(pluginInstance, 'markdown')) {
            return;
        }

        try {
            const resolvedLink = await resolveUrlToEagleLink(clipboardText, pluginInstance);
            editor.replaceSelection(createMarkdownLink(resolvedLink, pluginInstance.settings.imageSize));
            new Notice('URL uploaded successfully, please wait for Eagle link update', 12000);
        } catch (error) {
            print(`URL upload failed: ${toErrorMessage(error)}`);
            new Notice('URL upload failed');
        }
        return;
    }

    if (!filePath) {
        return;
    }

    try {
        const resolvedLink = await resolveFilePathToEagleLink(filePath, pluginInstance);
        editor.replaceSelection(createMarkdownLink(resolvedLink, pluginInstance.settings.imageSize));
        new Notice('Eagle link converted');
    } catch (error) {
        if (toErrorMessage(error) === 'NON_EAGLE_FILE') {
            new Notice('Non-Eagle link');
            return;
        }

        print(`File upload failed: ${toErrorMessage(error)}`);
        new Notice('File upload failed, check if Eagle is running');
    }
}

async function uploadByClipboard(filePath: string, pluginInstance: MyPlugin): Promise<void> {
    const folderId = pluginInstance.settings.folderId || '';
    const tags = getCurrentPageTags(pluginInstance.app, pluginInstance.settings);
    const data = {
        path: filePath,
        name: path.basename(filePath),
        folderId,
        tags,
    };

    const response = await fetch('http://localhost:41595/api/item/addFromPath', {
        method: 'POST',
        body: JSON.stringify(data),
        redirect: 'follow' as RequestRedirect,
    });

    if (!response.ok) {
        throw new Error('UPLOAD_FAILED');
    }
}

async function uploadByUrl(url: string, pluginInstance: MyPlugin): Promise<void> {
    const folderId = pluginInstance.settings.folderId || '';
    const tags = getCurrentPageTags(pluginInstance.app, pluginInstance.settings);
    const data = {
        url,
        folderId,
        tags,
    };

    print('Request data:', data);

    const response = await fetch('http://localhost:41595/api/item/addBookmark', {
        method: 'POST',
        body: JSON.stringify(data),
        redirect: 'follow' as RequestRedirect,
    });

    if (!response.ok) {
        try {
            const errorResult = await response.json();
            console.error('Error response:', errorResult);
        } catch (error) {
            print(`Failed to parse upload error: ${toErrorMessage(error)}`);
        }
        throw new Error('UPLOAD_FAILED');
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

    const transferFiles = Array.from(dropEvent.dataTransfer?.files ?? []);
    if (transferFiles.length === 0) {
        return;
    }

    if (!shouldUploadTransferFiles(transferFiles, pluginInstance, 'markdown')) {
        return;
    }

    consumeHandledEvent(dropEvent);

    for (const file of transferFiles) {
        try {
            const filePath = await getTransferFilePath(file);
            print(`Drag file path: ${filePath}`);

            const resolvedLink = await resolveFilePathToEagleLink(filePath, pluginInstance);
            editor.replaceSelection(createMarkdownLink(resolvedLink, pluginInstance.settings.imageSize));
            new Notice('Eagle link converted');
        } catch (error) {
            if (toErrorMessage(error) === 'NON_EAGLE_FILE') {
                new Notice('Non-Eagle link');
                continue;
            }

            print(`File upload failed: ${toErrorMessage(error)}`);
            new Notice('File upload failed, check if Eagle is running');
        }
    }
}
