import { App, Notice, TFile } from 'obsidian';
import type { EagleLinkTarget } from './libraryProfiles';
import { findLibraryProfileByPort } from './libraryProfiles';
import { buildEagleLinkTargetKey, parseEagleLinkTargetsFromText } from './eagleLinks';
import { getItemInfoFromLibrary, updateItemInLibrary } from './eagleApi';
import { MyPluginSettings } from './setting';
import { print } from './main';

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
	itemTargets: EagleLinkTarget[];
	itemTargetSignature: string;
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
	return syncTagsToTargets(settings, syncState.pageTags, syncState.itemTargets, options);
}

export async function syncTagsToTargets(
	settings: MyPluginSettings,
	pageTags: string[],
	targets: EagleLinkTarget[],
	options: SyncPageTagsOptions = {},
): Promise<SyncPageTagsResult> {
	try {
		const strategy = options.strategy ?? 'append';
		if (targets.length === 0) {
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
		for (const target of targets) {
			const profile = findLibraryProfileByPort(settings, target.port);
			if (!profile?.resolvedPath) {
				continue;
			}

			const itemInfo = await getItemInfoFromLibrary(profile, target.itemId);
			if (!itemInfo) {
				continue;
			}

			const mergedTags = strategy === 'replace'
				? mergeUniqueStrings(pageTags)
				: mergeUniqueStrings(itemInfo.tags, pageTags);

			if (haveSameStringSet(itemInfo.tags, mergedTags)) {
				continue;
			}

			const updated = await updateItemInLibrary(profile, target.itemId, { tags: mergedTags });
			if (updated) {
				updatedCount += 1;
			}
		}

		if (options.notify !== false) {
			if (updatedCount > 0) {
				new Notice(
					strategy === 'replace'
						? `Aligned current page tags to ${updatedCount} Eagle item(s).`
						: `Appended current page tags to ${updatedCount} Eagle item(s).`,
				);
			} else {
				new Notice(
					strategy === 'replace'
						? 'Current page tags are already aligned.'
						: 'Current page tags are already appended.',
				);
			}
		}

		return {
			matchedCount: targets.length,
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
	const itemTargets = await getEagleTargetsFromFile(app, file);

	return {
		pageTags,
		tagSignature: buildStringSignature(pageTags),
		itemTargets,
		itemTargetSignature: buildTargetSignature(itemTargets),
	};
}

export async function getEagleTargetsFromFile(app: App, file: TFile): Promise<EagleLinkTarget[]> {
	const fileContent = await app.vault.read(file);
	return parseEagleLinkTargetsFromText(fileContent);
}

export async function getTagsForTargets(settings: MyPluginSettings, targets: EagleLinkTarget[]): Promise<string[]> {
	const allTags = new Set<string>();

	for (const target of targets) {
		const profile = findLibraryProfileByPort(settings, target.port);
		if (!profile?.resolvedPath) {
			continue;
		}

		const itemInfo = await getItemInfoFromLibrary(profile, target.itemId);
		for (const tag of itemInfo?.tags ?? []) {
			allTags.add(tag);
		}
	}

	return Array.from(allTags);
}

export async function mergeItemTagsIntoFileFrontmatter(
	app: App,
	file: TFile,
	settings: MyPluginSettings,
	targets: EagleLinkTarget[],
): Promise<MergeItemTagsIntoFileResult> {
	if (targets.length === 0) {
		return { mergedTags: [], changed: false };
	}

	const itemTags = await getTagsForTargets(settings, targets);
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

function getPageTags(app: App, file: TFile, settings: MyPluginSettings): string[] {
	const fileCache = app.metadataCache.getFileCache(file);
	return normalizeFrontmatterTags(fileCache?.frontmatter?.tags);
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

function buildTargetSignature(targets: EagleLinkTarget[]): string {
	return targets
		.map((target) => buildEagleLinkTargetKey(target.port, target.itemId))
		.sort((left, right) => left.localeCompare(right))
		.join('\u0001');
}
