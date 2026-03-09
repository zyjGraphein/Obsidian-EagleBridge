import { App, Notice, TFile } from 'obsidian';
import { MyPluginSettings } from './setting';
import { print } from './main';

const EAGLE_ITEM_INFO_URL_REGEX = /http:\/\/localhost:\d+\/images\/([^/\s]+)\.info/gi;
const EAGLE_API_BASE_URL = 'http://localhost:41595/api/item';

export type PageTagsToEagleStrategy = 'append' | 'replace';

interface SyncPageTagsOptions {
	notify?: boolean;
	strategy?: PageTagsToEagleStrategy;
}

interface SyncPageTagsResult {
	matchedCount: number;
	updatedCount: number;
	pageTags: string[];
}

export interface FileTagSyncState {
	pageTags: string[];
	tagSignature: string;
	itemIds: string[];
	itemIdsSignature: string;
}

export interface MergeItemTagsIntoFileResult {
	mergedTags: string[];
	changed: boolean;
}

export async function syncCurrentPageTags(app: App, settings: MyPluginSettings, options: SyncPageTagsOptions = {}): Promise<SyncPageTagsResult | null> {
	const activeFile = app.workspace.getActiveFile();
	if (!activeFile) {
		if (options.notify !== false) {
			new Notice('No active file found.');
		}
		return null;
	}

	return syncTagsForFile(app, activeFile, settings, options);
}

export async function syncTagsForFile(
	app: App,
	file: TFile,
	settings: MyPluginSettings,
	options: SyncPageTagsOptions = {},
): Promise<SyncPageTagsResult> {
	const syncState = await getFileTagSyncState(app, file, settings);
	return syncTagsToItemIds(syncState.pageTags, syncState.itemIds, options);
}

export async function syncTagsToItemIds(
	pageTags: string[],
	itemIds: string[],
	options: SyncPageTagsOptions = {},
): Promise<SyncPageTagsResult> {
	try {
		const strategy = options.strategy ?? 'append';
		if (itemIds.length === 0) {
			if (options.notify !== false) {
				new Notice('No Eagle items found in the current page.');
			}

			return {
				matchedCount: 0,
				updatedCount: 0,
				pageTags,
			};
		}

		let updatedCount = 0;
		for (const id of itemIds) {
			const currentTags = await fetchTagsForInfoFile(id);
			const mergedTags = strategy === 'replace'
				? mergeUniqueStrings(pageTags)
				: mergeUniqueStrings(currentTags, pageTags);

			if (haveSameStringSet(currentTags, mergedTags)) {
				continue;
			}

			await updateTagsForInfoFile(id, mergedTags);
			updatedCount += 1;
		}

		if (options.notify !== false) {
			if (updatedCount > 0) {
				new Notice(
					strategy === 'replace'
						? `Aligned current page tags to ${updatedCount} Eagle item(s).`
						: `Appended current page tags to ${updatedCount} Eagle item(s).`
				);
			} else {
				new Notice(
					strategy === 'replace'
						? 'Current page tags are already aligned.'
						: 'Current page tags are already appended.'
				);
			}
		}

		return {
			matchedCount: itemIds.length,
			updatedCount,
			pageTags,
		};
	} catch (error) {
		print('Error syncing page tags to Eagle:', error);
		if (options.notify !== false) {
			new Notice('Error syncing page tags to Eagle. Check console for details.');
		}
		throw error;
	}
}

export function getCurrentPageTags(app: App, settings: MyPluginSettings): string[] {
	const activeFile = app.workspace.getActiveFile();
	if (!activeFile) {
		return [];
	}

	return getPageTags(app, activeFile, settings);
}

export async function getFileTagSyncState(app: App, file: TFile, settings: MyPluginSettings): Promise<FileTagSyncState> {
	const pageTags = getPageTags(app, file, settings);
	const itemIds = await getInfoFileIdsFromFile(app, file);

	return {
		pageTags,
		tagSignature: buildStringSignature(pageTags),
		itemIds,
		itemIdsSignature: buildStringSignature(itemIds),
	};
}

export async function getInfoFileIdsFromFile(app: App, file: TFile): Promise<string[]> {
	const fileContent = await app.vault.read(file);
	return extractInfoFileIdsFromContent(fileContent);
}

export async function getTagsForItemIds(itemIds: string[]): Promise<string[]> {
	const allTags = new Set<string>();

	for (const itemId of itemIds) {
		const tags = await fetchTagsForInfoFile(itemId);
		for (const tag of tags) {
			allTags.add(tag);
		}
	}

	return Array.from(allTags);
}

export async function mergeItemTagsIntoFileFrontmatter(app: App, file: TFile, itemIds: string[]): Promise<MergeItemTagsIntoFileResult> {
	if (itemIds.length === 0) {
		return { mergedTags: [], changed: false };
	}

	const itemTags = await getTagsForItemIds(itemIds);
	if (itemTags.length === 0) {
		return { mergedTags: [], changed: false };
	}

	let mergedTags: string[] = [];
	let changed = false;
	await app.fileManager.processFrontMatter(file, (frontmatter) => {
		const currentTags = normalizeFrontmatterTags(frontmatter.tags);
		mergedTags = mergeUniqueStrings(currentTags, itemTags);
		changed = !haveSameStringSet(currentTags, mergedTags);
		if (changed) {
			frontmatter.tags = mergedTags;
		}
	});

	return { mergedTags, changed };
}

async function fetchTagsForInfoFile(id: string): Promise<string[]> {
	const requestOptions: RequestInit = {
		method: 'GET',
		redirect: 'follow' as RequestRedirect,
	};

	const response = await fetch(`${EAGLE_API_BASE_URL}/info?id=${encodeURIComponent(id)}`, requestOptions);
	const result = await response.json();
	return normalizeFrontmatterTags(result?.data?.tags);
}

async function updateTagsForInfoFile(id: string, tags: string[]) {
	const data = {
		id,
		tags,
	};

	const requestOptions: RequestInit = {
		method: 'POST',
		body: JSON.stringify(data),
		redirect: 'follow' as RequestRedirect,
	};

	const response = await fetch(`${EAGLE_API_BASE_URL}/update`, requestOptions);
	const result = await response.json();
	print(`Updated tags for ${id}:`, result);
}

function getPageTags(app: App, file: TFile, settings: MyPluginSettings): string[] {
	const fileCache = app.metadataCache.getFileCache(file);
	return normalizeFrontmatterTags(fileCache?.frontmatter?.tags);
}

function extractInfoFileIdsFromContent(fileContent: string): string[] {
	const ids = new Set<string>();

	let match: RegExpExecArray | null;
	while ((match = EAGLE_ITEM_INFO_URL_REGEX.exec(fileContent)) !== null) {
		ids.add(match[1]);
	}

	EAGLE_ITEM_INFO_URL_REGEX.lastIndex = 0;
	return Array.from(ids);
}

function normalizeFrontmatterTags(value: unknown): string[] {
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

function mergeUniqueStrings(...values: string[][]): string[] {
	const mergedValues = new Set<string>();

	for (const entries of values) {
		for (const entry of entries) {
			const normalizedEntry = entry.trim();
			if (normalizedEntry.length > 0) {
				mergedValues.add(normalizedEntry);
			}
		}
	}

	return Array.from(mergedValues);
}

function haveSameStringSet(left: string[], right: string[]): boolean {
	if (left.length !== right.length) {
		return false;
	}

	const leftSet = new Set(left);
	for (const value of right) {
		if (!leftSet.has(value)) {
			return false;
		}
	}

	return true;
}

function buildStringSignature(values: string[]): string {
	return values
		.slice()
		.sort((left, right) => left.localeCompare(right))
		.join('\u0001');
}
