import * as fs from 'fs';
import * as path from 'path';
import { App, Notice, TFile } from 'obsidian';
import { MyPluginSettings } from './setting';
import { print } from './main';
import { findLibraryProfileByPort, getEnabledResolvedLibraryProfiles } from './libraryProfiles';

interface ObsidianLinkEntry {
	name: string;
	url: string;
}

interface EagleMetadata {
	Obsidian?: ObsidianLinkEntry[];
	[key: string]: unknown;
}

interface SyncObsidianLinkOptions {
	notify?: boolean;
	itemKeys?: string[];
}

interface EagleLinkTarget {
	itemId: string;
	port: number;
}

export async function syncCurrentPageObsidianLinkToEagle(app: App, settings: MyPluginSettings): Promise<void> {
	const activeFile = app.workspace.getActiveFile();
	if (!activeFile) {
		new Notice('No active file found.');
		return;
	}

	await syncObsidianLinkForFile(app, activeFile, settings, { notify: true });
}

export async function syncObsidianLinkForFile(
	app: App,
	file: TFile,
	settings: MyPluginSettings,
	options: SyncObsidianLinkOptions = {},
): Promise<void> {
	const shouldNotify = options.notify !== false;

	if (getEnabledResolvedLibraryProfiles(settings).length === 0) {
		if (shouldNotify) {
			new Notice('No available Eagle library profile is configured.');
		}
		return;
	}

	if (!settings.obsidianStoreId?.trim()) {
		if (shouldNotify) {
			new Notice('Obsidian store ID is required.');
		}
		return;
	}

	const pageUid = getCurrentPageUid(app, file);
	if (!pageUid) {
		if (shouldNotify) {
			new Notice('Current page YAML id is required for advanced URI.');
		}
		return;
	}

	const content = await app.vault.read(file);
	const allTargets = extractLinkTargetsFromContent(content);
	const targets = options.itemKeys?.length
		? allTargets.filter((target) => options.itemKeys?.includes(`${target.port}:${target.itemId}`))
		: allTargets;
	if (targets.length === 0) {
		if (shouldNotify) {
			new Notice('No Eagle items found in the current page.');
		}
		return;
	}

	const linkEntry: ObsidianLinkEntry = {
		name: file.basename,
		url: `obsidian://adv-uri?vault=${encodeURIComponent(settings.obsidianStoreId.trim())}&uid=${encodeURIComponent(pageUid)}`,
	};

	let updatedCount = 0;
	for (const target of targets) {
		const profile = findLibraryProfileByPort(settings, target.port);
		if (!profile?.resolvedPath) {
			print(`Skipped unresolved Eagle profile for port ${target.port}`);
			continue;
		}

		const metadataPath = path.join(profile.resolvedPath, 'images', `${target.itemId}.info`, 'metadata.json');
		if (!fs.existsSync(metadataPath)) {
			print(`Skipped missing metadata.json for Eagle item ${target.itemId}`);
			continue;
		}

		try {
			const raw = fs.readFileSync(metadataPath, 'utf8');
			const metadata = JSON.parse(raw) as EagleMetadata;
			const nextLinks = mergeObsidianLink(metadata.Obsidian, linkEntry);

			if (hasSameObsidianLinks(metadata.Obsidian, nextLinks)) {
				continue;
			}

			metadata.Obsidian = nextLinks;
			fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
			updatedCount += 1;
		} catch (error) {
			print(`Failed to update Obsidian metadata for Eagle item ${target.itemId}:`, error);
		}
	}

	if (shouldNotify) {
		if (updatedCount > 0) {
			new Notice(`Sent current page link to ${updatedCount} Eagle item(s).`);
		} else {
			new Notice('Current page link is already present in Eagle.');
		}
	}
}

function extractLinkTargetsFromContent(content: string): EagleLinkTarget[] {
	const targets = new Map<string, EagleLinkTarget>();
	const pattern = /http:\/\/localhost:(\d+)\/images\/([^/\s]+)\.info/gi;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(content)) !== null) {
		const port = Number.parseInt(match[1] || '', 10);
		const itemId = match[2] || '';
		if (!Number.isFinite(port) || !itemId) {
			continue;
		}

		targets.set(`${port}:${itemId}`, { port, itemId });
	}

	pattern.lastIndex = 0;
	return Array.from(targets.values());
}

function getCurrentPageUid(app: App, file: TFile): string | null {
	const fileCache = app.metadataCache.getFileCache(file);
	const frontmatterId = fileCache?.frontmatter?.id;

	if (typeof frontmatterId === 'string' && frontmatterId.trim().length > 0) {
		return frontmatterId.trim();
	}

	if (typeof frontmatterId === 'number' && Number.isFinite(frontmatterId)) {
		return String(frontmatterId);
	}

	return null;
}

function mergeObsidianLink(existingEntries: ObsidianLinkEntry[] | undefined, nextEntry: ObsidianLinkEntry): ObsidianLinkEntry[] {
	const normalizedEntries = Array.isArray(existingEntries)
		? existingEntries.filter((entry) => entry && typeof entry.url === 'string').map((entry) => ({
			name: typeof entry.name === 'string' && entry.name.trim().length > 0 ? entry.name.trim() : 'Obsidian',
			url: entry.url,
		}))
		: [];

	const existingIndex = normalizedEntries.findIndex((entry) => entry.url === nextEntry.url);
	if (existingIndex >= 0) {
		normalizedEntries[existingIndex] = nextEntry;
		return normalizedEntries;
	}

	normalizedEntries.push(nextEntry);
	return normalizedEntries;
}

function hasSameObsidianLinks(left: ObsidianLinkEntry[] | undefined, right: ObsidianLinkEntry[]): boolean {
	if (!Array.isArray(left) || left.length !== right.length) {
		return false;
	}

	return left.every((entry, index) => entry?.name === right[index]?.name && entry?.url === right[index]?.url);
}
