import { existsSync } from 'fs';
import * as path from 'path';
import type { EagleLibraryProfileSettings, MyPluginSettings } from './setting';
import { isPathInsideDirectory } from './eaglePaths';

export const MAX_LIBRARY_PROFILES = 5;
export const DEFAULT_EXTERNAL_UPLOAD_MODE = 'fixed' as const;

export interface EagleLinkTarget {
	itemId: string;
	port: number;
}

export interface ResolvedEagleLibraryProfile extends EagleLibraryProfileSettings {
	resolvedPath: string;
}

interface LegacySettingsShape {
	port?: unknown;
	libraryPaths?: unknown;
	libraryPath?: unknown;
	folderId?: unknown;
	libraryProfiles?: unknown;
}

function createProfileId(): string {
	return `library-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function normalizePort(value: unknown, fallbackPort: number): number {
	const numericValue = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
	return Number.isFinite(numericValue) && numericValue >= 1000 && numericValue <= 65535
		? numericValue
		: fallbackPort;
}

function normalizeAlias(value: unknown, fallbackAlias: string): string {
	if (typeof value !== 'string') {
		return fallbackAlias;
	}

	const trimmedValue = value.trim();
	return trimmedValue.length > 0 ? trimmedValue : fallbackAlias;
}

function normalizePaths(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const uniquePaths = new Set<string>();
	for (const entry of value) {
		if (typeof entry !== 'string') {
			continue;
		}

		const trimmedPath = entry.trim();
		if (trimmedPath.length > 0) {
			uniquePaths.add(trimmedPath);
		}
	}

	return Array.from(uniquePaths);
}

function normalizeFolderId(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function normalizeProfile(
	value: unknown,
	index: number,
	usedPorts: Set<number>,
): EagleLibraryProfileSettings {
	const fallbackPort = 6060 + index;
	const nextValue = value && typeof value === 'object' ? value as Record<string, unknown> : {};
	let servePort = normalizePort(nextValue.servePort, fallbackPort);
	while (usedPorts.has(servePort)) {
		servePort += 1;
	}
	usedPorts.add(servePort);

	return {
		id: typeof nextValue.id === 'string' && nextValue.id.trim().length > 0 ? nextValue.id.trim() : createProfileId(),
		alias: normalizeAlias(nextValue.alias, `Library ${index + 1}`),
		servePort,
		paths: normalizePaths(nextValue.paths),
		resolvedPath: typeof nextValue.resolvedPath === 'string' ? nextValue.resolvedPath.trim() : '',
		folderId: normalizeFolderId(nextValue.folderId),
		enabled: true,
	};
}

function migrateLegacyLibraryProfiles(data: LegacySettingsShape): EagleLibraryProfileSettings[] {
	const legacyPaths = normalizePaths(data.libraryPaths);
	const legacySinglePath = typeof data.libraryPath === 'string' ? data.libraryPath.trim() : '';
	if (legacyPaths.length === 0 && legacySinglePath.length > 0) {
		legacyPaths.push(legacySinglePath);
	}

	if (legacyPaths.length === 0) {
		return [];
	}

	return [{
		id: createProfileId(),
		alias: 'Default library',
		servePort: normalizePort(data.port, 6060),
		paths: legacyPaths,
		resolvedPath: '',
		folderId: normalizeFolderId(data.folderId),
		enabled: true,
	}];
}

export function normalizeLibraryProfiles(data: LegacySettingsShape | null | undefined): EagleLibraryProfileSettings[] {
	const rawProfiles = Array.isArray(data?.libraryProfiles) ? data?.libraryProfiles : null;
	const usedPorts = new Set<number>();
	const normalizedProfiles = (rawProfiles ?? migrateLegacyLibraryProfiles(data ?? {}))
		.slice(0, MAX_LIBRARY_PROFILES)
		.map((profile, index) => normalizeProfile(profile, index, usedPorts));

	if (normalizedProfiles.length === 0) {
		return [];
	}

	return normalizedProfiles;
}

export function createEmptyLibraryProfile(index: number): EagleLibraryProfileSettings {
	return {
		id: createProfileId(),
		alias: `Library ${index + 1}`,
		servePort: 6060 + index,
		paths: [],
		resolvedPath: '',
		folderId: '',
		enabled: true,
	};
}

export function resolveLibraryProfiles(
	profiles: EagleLibraryProfileSettings[] | null | undefined,
): ResolvedEagleLibraryProfile[] {
	return (profiles ?? []).map((profile) => ({
		...profile,
		resolvedPath: profile.paths.find((candidatePath) => existsSync(candidatePath)) ?? '',
	}));
}

export function syncLegacyLibrarySettings(settings: MyPluginSettings): ResolvedEagleLibraryProfile[] {
	const resolvedProfiles = resolveLibraryProfiles(settings.libraryProfiles);
	settings.libraryProfiles = resolvedProfiles;

	const primaryProfile = resolvedProfiles.find((profile) => profile.resolvedPath)
		?? resolvedProfiles[0];

	settings.libraryPath = primaryProfile?.resolvedPath ?? '';
	settings.libraryPaths = primaryProfile?.paths.slice() ?? [];
	settings.port = primaryProfile?.servePort ?? 6060;
	settings.folderId = primaryProfile?.folderId ?? '';

	if (settings.externalUploadMode !== 'fixed' && settings.externalUploadMode !== 'askEveryTime') {
		settings.externalUploadMode = DEFAULT_EXTERNAL_UPLOAD_MODE;
	}

	if (!settings.defaultUploadTargetId && primaryProfile?.id) {
		settings.defaultUploadTargetId = primaryProfile.id;
	}

	return resolvedProfiles;
}

export function getResolvedLibraryProfiles(settings: MyPluginSettings): ResolvedEagleLibraryProfile[] {
	return resolveLibraryProfiles(settings.libraryProfiles);
}

export function getEnabledResolvedLibraryProfiles(settings: MyPluginSettings): ResolvedEagleLibraryProfile[] {
	return getResolvedLibraryProfiles(settings).filter((profile) => profile.resolvedPath);
}

export function findLibraryProfileByPort(
	settings: MyPluginSettings,
	port: number,
): ResolvedEagleLibraryProfile | null {
	return getResolvedLibraryProfiles(settings).find((profile) => profile.servePort === port) ?? null;
}

export function findLibraryProfileById(
	settings: MyPluginSettings,
	profileId: string | null | undefined,
): ResolvedEagleLibraryProfile | null {
	if (!profileId) {
		return null;
	}

	return getResolvedLibraryProfiles(settings).find((profile) => profile.id === profileId) ?? null;
}

export function findLibraryProfileByFilePath(
	settings: MyPluginSettings,
	filePath: string,
): ResolvedEagleLibraryProfile | null {
	for (const profile of getResolvedLibraryProfiles(settings)) {
		if (!profile.resolvedPath) {
			continue;
		}

		if (isPathInsideDirectory(filePath, profile.resolvedPath)) {
			return profile;
		}
	}

	return null;
}

export function getFixedUploadTargetProfile(settings: MyPluginSettings): ResolvedEagleLibraryProfile | null {
	const targetById = findLibraryProfileById(settings, settings.defaultUploadTargetId);
	if (targetById?.resolvedPath) {
		return targetById;
	}

	return getEnabledResolvedLibraryProfiles(settings)[0] ?? null;
}

export function hasAnyResolvedUploadTarget(settings: MyPluginSettings): boolean {
	return getEnabledResolvedLibraryProfiles(settings).length > 0;
}

export function buildLibraryItemUrl(port: number, itemId: string): string {
	return `http://localhost:${port}/images/${itemId}.info`;
}

export function extractEagleLinkTarget(rawUrl: string): EagleLinkTarget | null {
	try {
		const parsedUrl = new URL(rawUrl);
		if (!/^https?:$/i.test(parsedUrl.protocol) || parsedUrl.hostname !== 'localhost') {
			return null;
		}

		const port = Number.parseInt(parsedUrl.port, 10);
		if (!Number.isFinite(port)) {
			return null;
		}

		const match = decodeURIComponent(parsedUrl.pathname).match(/^\/images\/([^/]+)\.info(?:\/|$)/i);
		if (!match?.[1]) {
			return null;
		}

		return {
			itemId: match[1],
			port,
		};
	} catch {
		return null;
	}
}

export function getLibraryItemPathForProfile(filePath: string, profile: ResolvedEagleLibraryProfile): string | null {
	if (!profile.resolvedPath || !isPathInsideDirectory(filePath, path.join(profile.resolvedPath, 'images'))) {
		return null;
	}

	const relativePath = path.relative(path.join(profile.resolvedPath, 'images'), path.resolve(filePath));
	const pathSegments = relativePath.split(path.sep).filter(Boolean);
	if (pathSegments.length < 2 || !/\.info$/i.test(pathSegments[0])) {
		return null;
	}

	return path.posix.join('images', pathSegments[0]);
}
