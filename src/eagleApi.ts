import * as fs from 'fs';
import * as path from 'path';
import { print } from './main';
import type { ResolvedEagleLibraryProfile } from './libraryProfiles';
import { resolveEagleItemById, resolveEagleItemByInfoDirectory, type EagleResolvedItem } from './eagleItemResolver';

const EAGLE_API_BASE_URL = 'http://localhost:41595/api';
const EAGLE_LIBRARY_INFO_ENDPOINTS = ['/v2/library/info', '/library/info'];
const EAGLE_LIBRARY_SWITCH_MAX_ATTEMPTS = 24;
const EAGLE_LIBRARY_SWITCH_POLL_INTERVAL_MS = 250;

let eagleLibraryOperationChain: Promise<void> = Promise.resolve();

export interface EagleItemInfo {
	id: string;
	name: string;
	ext: string;
	annotation: string;
	url: string;
	tags: string[];
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson(endpoint: string, data: Record<string, unknown>): Promise<any> {
	const response = await fetch(`${EAGLE_API_BASE_URL}${endpoint}`, {
		method: 'POST',
		body: JSON.stringify(data),
		redirect: 'follow' as RequestRedirect,
	});

	if (!response.ok) {
		throw new Error(`EAGLE_API_${endpoint.toUpperCase()}_FAILED`);
	}

	return response.json().catch(() => ({}));
}

async function getJson(endpoint: string): Promise<any> {
	const response = await fetch(`${EAGLE_API_BASE_URL}${endpoint}`, {
		method: 'GET',
		redirect: 'follow' as RequestRedirect,
	});

	if (!response.ok) {
		throw new Error(`EAGLE_API_${endpoint.toUpperCase()}_FAILED`);
	}

	return response.json().catch(() => ({}));
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

function normalizeLibraryPath(libraryPath: string): string {
	const normalizedPath = path.normalize(path.resolve(libraryPath)).replace(/[\\/]+$/, '');
	return process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
}

function isSameLibraryPath(left: string | null | undefined, right: string | null | undefined): boolean {
	if (!left || !right) {
		return false;
	}

	return normalizeLibraryPath(left) === normalizeLibraryPath(right);
}

function extractLibraryPath(result: any): string | null {
	const data = result?.data;
	if (!data || typeof data !== 'object') {
		return null;
	}

	if (typeof data.path === 'string') {
		return data.path;
	}

	if (typeof data.libraryPath === 'string') {
		return data.libraryPath;
	}

	const nestedLibrary = (data as { library?: { path?: unknown } }).library;
	if (nestedLibrary && typeof nestedLibrary.path === 'string') {
		return nestedLibrary.path;
	}

	return null;
}

async function getCurrentLibraryPath(): Promise<string | null> {
	for (const endpoint of EAGLE_LIBRARY_INFO_ENDPOINTS) {
		try {
			const result = await getJson(endpoint);
			const currentPath = extractLibraryPath(result);
			if (currentPath) {
				return currentPath;
			}
		} catch {
			continue;
		}
	}

	return null;
}

function queueEagleLibraryOperation<T>(operation: () => Promise<T>): Promise<T> {
	const queuedOperation = eagleLibraryOperationChain.then(operation, operation);
	eagleLibraryOperationChain = queuedOperation.then(() => undefined, () => undefined);
	return queuedOperation;
}

async function ensureEagleLibraryActive(libraryPath: string): Promise<void> {
	if (!libraryPath) {
		throw new Error('EAGLE_LIBRARY_PATH_MISSING');
	}

	const currentLibraryPath = await getCurrentLibraryPath();
	if (isSameLibraryPath(currentLibraryPath, libraryPath)) {
		return;
	}

	const result = await postJson('/library/switch', { libraryPath });
	if (result?.status && result.status !== 'success') {
		throw new Error('EAGLE_LIBRARY_SWITCH_FAILED');
	}

	if (!currentLibraryPath) {
		await delay(EAGLE_LIBRARY_SWITCH_POLL_INTERVAL_MS * 2);
		return;
	}

	for (let attempt = 0; attempt < EAGLE_LIBRARY_SWITCH_MAX_ATTEMPTS; attempt += 1) {
		const activeLibraryPath = await getCurrentLibraryPath();
		if (activeLibraryPath) {
			if (isSameLibraryPath(activeLibraryPath, libraryPath)) {
				return;
			}
		} else {
			await delay(EAGLE_LIBRARY_SWITCH_POLL_INTERVAL_MS * 2);
			return;
		}

		await delay(EAGLE_LIBRARY_SWITCH_POLL_INTERVAL_MS);
	}

	throw new Error('EAGLE_LIBRARY_SWITCH_TIMEOUT');
}

async function runInEagleLibraryContext<T>(libraryPath: string, operation: () => Promise<T>): Promise<T> {
	return queueEagleLibraryOperation(async () => {
		await ensureEagleLibraryActive(libraryPath);
		return operation();
	});
}

export async function switchEagleLibrary(libraryPath: string): Promise<void> {
	await queueEagleLibraryOperation(() => ensureEagleLibraryActive(libraryPath));
}

async function listRecentInfoDirectories(libraryPath: string): Promise<Array<{ infoDirPath: string; mtimeMs: number }>> {
	const imagesPath = path.join(libraryPath, 'images');
	const entries = await fs.promises.readdir(imagesPath, { withFileTypes: true });
	const infoDirectories = entries
		.filter((entry) => entry.isDirectory() && /\.info$/i.test(entry.name))
		.map((entry) => path.join(imagesPath, entry.name));

	const stats = await Promise.all(infoDirectories.map(async (infoDirPath) => ({
		infoDirPath,
		stats: await fs.promises.stat(infoDirPath).catch(() => null),
	})));

	return stats
		.filter((entry): entry is { infoDirPath: string; stats: fs.Stats } => Boolean(entry.stats))
		.map((entry) => ({
			infoDirPath: entry.infoDirPath,
			mtimeMs: entry.stats.mtimeMs,
		}))
		.sort((left, right) => right.mtimeMs - left.mtimeMs)
		.slice(0, 40);
}

function matchesUploadedFile(
	item: EagleResolvedItem,
	filePath: string,
	startedAtMs: number,
	infoDirMtimeMs: number,
): boolean {
	if (infoDirMtimeMs + 1500 < startedAtMs) {
		return false;
	}

	const sourceFileName = path.basename(filePath);
	if (item.sourceFileName === sourceFileName || item.expectedFileName === sourceFileName) {
		return true;
	}

	return false;
}

function matchesUploadedUrl(
	item: EagleResolvedItem,
	targetUrl: string,
	startedAtMs: number,
	infoDirMtimeMs: number,
): boolean {
	if (infoDirMtimeMs + 1500 < startedAtMs) {
		return false;
	}

	return item.externalUrl === targetUrl;
}

async function waitForUploadedItem(
	libraryPath: string,
	matcher: (item: EagleResolvedItem, infoDirMtimeMs: number) => boolean,
): Promise<EagleResolvedItem | null> {
	for (let attempt = 0; attempt < 24; attempt += 1) {
		const recentInfoDirectories = await listRecentInfoDirectories(libraryPath);
		for (const entry of recentInfoDirectories) {
			const resolvedItem = await resolveEagleItemByInfoDirectory(entry.infoDirPath);
			if (!resolvedItem) {
				continue;
			}

			if (matcher(resolvedItem, entry.mtimeMs)) {
				return resolvedItem;
			}
		}

		await delay(250);
	}

	return null;
}

export async function uploadFileToLibrary(
	filePath: string,
	profile: ResolvedEagleLibraryProfile,
	tags: string[],
): Promise<EagleResolvedItem> {
	return runInEagleLibraryContext(profile.resolvedPath, async () => {
		const startedAtMs = Date.now();
		await postJson('/item/addFromPath', {
			path: filePath,
			name: path.basename(filePath),
			folderId: profile.folderId || '',
			tags,
		});

		const uploadedItem = await waitForUploadedItem(profile.resolvedPath, (item, infoDirMtimeMs) =>
			matchesUploadedFile(item, filePath, startedAtMs, infoDirMtimeMs),
		);
		if (!uploadedItem) {
			throw new Error('UPLOADED_ITEM_NOT_FOUND');
		}

		return uploadedItem;
	});
}

export async function uploadUrlToLibrary(
	targetUrl: string,
	profile: ResolvedEagleLibraryProfile,
	tags: string[],
): Promise<EagleResolvedItem> {
	return runInEagleLibraryContext(profile.resolvedPath, async () => {
		const startedAtMs = Date.now();
		await postJson('/item/addBookmark', {
			url: targetUrl,
			folderId: profile.folderId || '',
			tags,
		});

		const uploadedItem = await waitForUploadedItem(profile.resolvedPath, (item, infoDirMtimeMs) =>
			matchesUploadedUrl(item, targetUrl, startedAtMs, infoDirMtimeMs),
		);
		if (!uploadedItem) {
			throw new Error('UPLOADED_ITEM_NOT_FOUND');
		}

		return uploadedItem;
	});
}

export async function resolveItemFromLibrary(
	profile: ResolvedEagleLibraryProfile,
	itemId: string,
): Promise<EagleResolvedItem | null> {
	if (!profile.resolvedPath) {
		return null;
	}

	return resolveEagleItemById(profile.resolvedPath, itemId);
}

export async function getItemInfoFromLibrary(
	profile: ResolvedEagleLibraryProfile,
	itemId: string,
): Promise<EagleItemInfo | null> {
	try {
		const result = await runInEagleLibraryContext(
			profile.resolvedPath,
			() => getJson(`/item/info?id=${encodeURIComponent(itemId)}`),
		);
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
	} catch (error) {
		print('Get item info failed:', error);
		return null;
	}
}

export async function updateItemInLibrary(
	profile: ResolvedEagleLibraryProfile,
	itemId: string,
	data: {
		annotation?: string;
		url?: string;
		tags?: string[];
	},
): Promise<boolean> {
	try {
		const result = await runInEagleLibraryContext(profile.resolvedPath, () => postJson('/item/update', {
			id: itemId,
			...data,
		}));
		return result?.status === 'success' || result?.status === undefined;
	} catch (error) {
		print('Update item failed:', error);
		return false;
	}
}

export async function moveItemToTrashInLibrary(
	profile: ResolvedEagleLibraryProfile,
	itemId: string,
): Promise<boolean> {
	try {
		const result = await runInEagleLibraryContext(profile.resolvedPath, () => postJson('/item/moveToTrash', {
			itemIds: [itemId],
		}));
		return result?.status === 'success' || result?.status === undefined;
	} catch (error) {
		print('Move item to trash failed:', error);
		return false;
	}
}
