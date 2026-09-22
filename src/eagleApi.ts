import * as path from 'path';
import { print } from './main';
import type { ResolvedEagleLibraryProfile } from './libraryProfiles';
import { resolveEagleItemById, type EagleResolvedItem } from './eagleItemResolver';
import { isSameFileSystemPath } from './eaglePaths';

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

export interface EagleUploadedItem {
	itemId: string;
	fileName: string;
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

	const result = await response.json();
	if (result?.status !== 'success') {
		throw new Error(`EAGLE_API_${endpoint.toUpperCase()}_FAILED`);
	}
	return result;
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

function isSameLibraryPath(left: string | null | undefined, right: string | null | undefined): boolean {
	if (!left || !right) {
		return false;
	}

	return isSameFileSystemPath(left, right);
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

	await postJson('/library/switch', { libraryPath });

	for (let attempt = 0; attempt < EAGLE_LIBRARY_SWITCH_MAX_ATTEMPTS; attempt += 1) {
		const activeLibraryPath = await getCurrentLibraryPath();
		if (isSameLibraryPath(activeLibraryPath, libraryPath)) {
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

function getUploadedItemId(result: any): string | null {
	const data = Array.isArray(result?.data) && result.data.length === 1 ? result.data[0] : result?.data;
	const itemId = typeof data === 'string' ? data : data?.id;
	return typeof itemId === 'string' && /^[a-z0-9_-]+$/i.test(itemId) ? itemId : null;
}

export async function uploadFileToLibrary(
	filePath: string,
	profile: ResolvedEagleLibraryProfile,
	tags: string[],
): Promise<EagleUploadedItem> {
	return runInEagleLibraryContext(profile.resolvedPath, async () => {
		const fileName = path.basename(filePath);
		// Eagle 4 returns IDs from addFromPaths, including a single-file batch.
		const result = await postJson('/item/addFromPaths', {
			items: [{ path: filePath, name: path.basename(filePath, path.extname(filePath)), tags }],
			folderId: profile.folderId || '',
		});
		const itemId = getUploadedItemId(result);
		if (!itemId) {
			throw new Error('UPLOADED_ITEM_ID_MISSING');
		}
		return { itemId, fileName };
	});
}

interface EagleBookmark {
	id: string;
	name: string;
	ext: string;
	url: string;
	modificationTime: number;
	isDeleted?: boolean;
}

async function listRecentBookmarks(name: string): Promise<EagleBookmark[]> {
	const query = new URLSearchParams({ keyword: name, ext: 'url', orderBy: '-CREATEDATE', limit: '100' });
	const result = await getJson(`/item/list?${query}`);
	if (result?.status !== 'success' || !Array.isArray(result.data)) {
		throw new Error('EAGLE_BOOKMARK_LOOKUP_FAILED');
	}
	return result.data;
}

export async function uploadUrlToLibrary(
	targetUrl: string,
	profile: ResolvedEagleLibraryProfile,
	tags: string[],
): Promise<EagleUploadedItem> {
	return runInEagleLibraryContext(profile.resolvedPath, async () => {
		const name = new URL(targetUrl).hostname;
		const previousIds = new Set((await listRecentBookmarks(name)).map((item) => item.id));
		const startedAtMs = Date.now();
		const result = await postJson('/item/addBookmark', {
			url: targetUrl,
			name,
			folderId: profile.folderId || '',
			tags,
		});
		const itemId = getUploadedItemId(result);
		if (itemId) {
			return { itemId, fileName: `${name}.url` };
		}
		// addBookmark does not promise an ID; query Eagle's index, never scan images/.
		for (let attempt = 0; attempt < 60; attempt += 1) {
			const candidates = (await listRecentBookmarks(name)).filter((item) =>
				!item.isDeleted && !previousIds.has(item.id) && item.url === targetUrl
				&& item.modificationTime >= startedAtMs - 1500,
			);
			if (candidates.length > 1) {
				throw new Error('UPLOADED_ITEM_AMBIGUOUS');
			}
			if (candidates.length === 1) {
				return { itemId: candidates[0].id, fileName: `${candidates[0].name}.url` };
			}
			await delay(500);
		}
		throw new Error('UPLOADED_ITEM_NOT_FOUND');
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
