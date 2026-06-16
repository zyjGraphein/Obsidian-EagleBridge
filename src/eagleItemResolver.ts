import * as fs from 'fs';
import * as path from 'path';

export interface EagleResolvedItem {
	itemId: string;
	infoDirPath: string;
	metadataPath: string;
	metadataName: string;
	metadataExt: string;
	expectedFileName: string;
	sourceFilePath: string | null;
	sourceFileName: string | null;
	externalUrl: string | null;
}

export interface EagleLocalItemInfo {
	id: string;
	name: string;
	ext: string;
	annotation: string;
	url: string;
	tags: string[];
}

interface EagleMetadataFile {
	id?: unknown;
	name?: unknown;
	ext?: unknown;
	annotation?: unknown;
	url?: unknown;
	tags?: unknown;
}

interface EagleSourceEntry {
	name: string;
	fullPath: string;
}

export async function resolveEagleItemById(libraryPath: string, itemId: string): Promise<EagleResolvedItem | null> {
	const normalizedLibraryPath = libraryPath.trim();
	const normalizedItemId = itemId.trim();
	if (!normalizedLibraryPath || !normalizedItemId) {
		return null;
	}

	const infoDirPath = path.join(path.resolve(normalizedLibraryPath), 'images', `${normalizedItemId}.info`);
	return resolveEagleItemByInfoDirectory(infoDirPath, normalizedItemId);
}

export async function readEagleItemInfoById(libraryPath: string, itemId: string): Promise<EagleLocalItemInfo | null> {
	const normalizedLibraryPath = libraryPath.trim();
	const normalizedItemId = itemId.trim();
	if (!normalizedLibraryPath || !normalizedItemId) {
		return null;
	}

	const metadataPath = path.join(path.resolve(normalizedLibraryPath), 'images', `${normalizedItemId}.info`, 'metadata.json');
	const metadata = await readMetadataFile(metadataPath);
	if (!metadata) {
		return null;
	}

	return buildLocalItemInfo(metadata, normalizedItemId);
}

export async function resolveEagleItemByInfoDirectory(
	infoDirPath: string,
	explicitItemId?: string,
): Promise<EagleResolvedItem | null> {
	const normalizedInfoDirPath = path.resolve(infoDirPath);
	const metadataPath = path.join(normalizedInfoDirPath, 'metadata.json');
	if (!(await pathExists(metadataPath))) {
		return null;
	}

	const metadata = await readMetadataFile(metadataPath);
	if (!metadata) {
		return null;
	}

	const itemId = explicitItemId?.trim() || getItemIdFromInfoDirPath(normalizedInfoDirPath);
	const metadataName = normalizeMetadataPart(metadata.name) || itemId;
	const metadataExt = normalizeMetadataPart(metadata.ext);
	const expectedFileName = buildExpectedFileName(metadataName, metadataExt);
	const sourceEntries = await listSourceEntries(normalizedInfoDirPath);
	const bestSourceEntry = await findBestSourceEntry(sourceEntries, metadataName, metadataExt, expectedFileName);
	const sourceFilePath = bestSourceEntry?.fullPath ?? null;
	const sourceFileName = bestSourceEntry?.name ?? null;
	const externalUrl = sourceFilePath && normalizeFileExtension(path.extname(sourceFilePath)) === '.url'
		? await readEagleShortcutUrl(sourceFilePath)
		: null;

	return {
		itemId,
		infoDirPath: normalizedInfoDirPath,
		metadataPath,
		metadataName,
		metadataExt,
		expectedFileName,
		sourceFilePath,
		sourceFileName,
		externalUrl,
	};
}

export async function resolveEagleSourceFilePath(libraryPath: string, itemId: string): Promise<string | null> {
	const resolvedItem = await resolveEagleItemById(libraryPath, itemId);
	return resolvedItem?.sourceFilePath ?? null;
}

export async function readEagleShortcutUrl(filePath: string): Promise<string | null> {
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

export function extractEagleItemIdFromPathname(pathname: string): string | null {
	const match = pathname.match(/\/images\/([^/]+)\.info(?:\/|$)/i);
	return match?.[1] ?? null;
}

function getItemIdFromInfoDirPath(infoDirPath: string): string {
	return path.basename(infoDirPath).replace(/\.info$/i, '');
}

function buildExpectedFileName(metadataName: string, metadataExt: string): string {
	if (!metadataExt) {
		return metadataName;
	}

	return `${metadataName}.${metadataExt}`;
}

async function readMetadataFile(metadataPath: string): Promise<EagleMetadataFile | null> {
	try {
		return JSON.parse(await fs.promises.readFile(metadataPath, 'utf8')) as EagleMetadataFile;
	} catch {
		return null;
	}
}

function buildLocalItemInfo(metadata: EagleMetadataFile, fallbackItemId: string): EagleLocalItemInfo {
	const itemId = normalizeMetadataPart(metadata.id) || fallbackItemId;
	const name = normalizeMetadataPart(metadata.name) || itemId;
	const ext = normalizeFileExtension(normalizeMetadataPart(metadata.ext));
	return {
		id: itemId,
		name,
		ext,
		annotation: normalizeMetadataPart(metadata.annotation),
		url: normalizeMetadataPart(metadata.url),
		tags: normalizeTags(metadata.tags),
	};
}

async function listSourceEntries(infoDirPath: string): Promise<EagleSourceEntry[]> {
	const entries = await fs.promises.readdir(infoDirPath, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile() && entry.name.toLowerCase() !== 'metadata.json')
		.map((entry) => ({
			name: entry.name,
			fullPath: path.join(infoDirPath, entry.name),
		}))
		.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true }));
}

async function findBestSourceEntry(
	sourceEntries: EagleSourceEntry[],
	metadataName: string,
	metadataExt: string,
	expectedFileName: string,
): Promise<EagleSourceEntry | null> {
	if (sourceEntries.length === 0) {
		return null;
	}

	const exactFileNameMatch = sourceEntries.find((entry) => entry.name === expectedFileName);
	if (exactFileNameMatch) {
		return exactFileNameMatch;
	}

	const normalizedUnicodeExpectedName = normalizeUnicode(expectedFileName);
	const unicodeMatch = sourceEntries.find((entry) => normalizeUnicode(entry.name) === normalizedUnicodeExpectedName);
	if (unicodeMatch) {
		return unicodeMatch;
	}

	const normalizedExpectedName = normalizeComparableName(expectedFileName);
	const caseInsensitiveMatch = sourceEntries.find((entry) => normalizeComparableName(entry.name) === normalizedExpectedName);
	if (caseInsensitiveMatch) {
		return caseInsensitiveMatch;
	}

	const normalizedMetadataExt = normalizeComparableExtension(metadataExt);
	const extensionMatches = normalizedMetadataExt
		? sourceEntries.filter((entry) => normalizeComparableExtension(path.extname(entry.name)) === normalizedMetadataExt)
		: [];
	if (extensionMatches.length === 1) {
		return extensionMatches[0];
	}

	const normalizedMetadataBaseName = normalizeComparableName(metadataName);
	const baseNameMatches = sourceEntries.filter((entry) =>
		normalizeComparableName(path.basename(entry.name, path.extname(entry.name))) === normalizedMetadataBaseName,
	);
	if (baseNameMatches.length > 0) {
		const preferredBaseNameMatch = normalizedMetadataExt
			? baseNameMatches.find((entry) => normalizeComparableExtension(path.extname(entry.name)) === normalizedMetadataExt)
			: null;
		return preferredBaseNameMatch ?? baseNameMatches[0];
	}

	if (extensionMatches.length > 0) {
		return extensionMatches[0];
	}

	if (sourceEntries.length === 1) {
		return sourceEntries[0];
	}

	const sizedEntries = await Promise.all(sourceEntries.map(async (entry) => ({
		entry,
		stats: await fs.promises.stat(entry.fullPath),
	})));
	sizedEntries.sort((left, right) => {
		if (right.stats.size !== left.stats.size) {
			return right.stats.size - left.stats.size;
		}
		return left.entry.name.localeCompare(right.entry.name, undefined, { sensitivity: 'base', numeric: true });
	});
	return sizedEntries[0]?.entry ?? null;
}

function normalizeMetadataPart(value: unknown): string {
	if (typeof value !== 'string') {
		return '';
	}

	return value.trim();
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

function normalizeUnicode(value: string): string {
	try {
		return value.normalize('NFC');
	} catch {
		return value;
	}
}

function normalizeComparableName(value: string): string {
	return normalizeUnicode(value).toLocaleLowerCase();
}

function normalizeFileExtension(value: string): string {
	const trimmedValue = value.trim();
	if (!trimmedValue) {
		return '';
	}

	return trimmedValue.startsWith('.') ? trimmedValue.toLocaleLowerCase() : `.${trimmedValue.toLocaleLowerCase()}`;
}

function normalizeComparableExtension(value: string): string {
	return normalizeFileExtension(value);
}

async function pathExists(targetPath: string): Promise<boolean> {
	try {
		await fs.promises.access(targetPath, fs.constants.F_OK);
		return true;
	} catch {
		return false;
	}
}
