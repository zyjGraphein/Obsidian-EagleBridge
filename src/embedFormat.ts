import type { App } from 'obsidian';
import * as fs from 'fs';
import * as nodePath from 'path';
import { extractEagleLinkTarget, findLibraryProfileByPort } from './libraryProfiles';
import type { MyPluginSettings } from './setting';
import type { ResolvedEagleLink } from './urlHandler';

export type FileNameMode = 'strip' | 'replace' | 'numbered' | 'custom';
export type ImageSizeMode = 'fixed' | 'ratio' | 'explicit';
export type SquareAlign = 'portrait' | 'landscape';
export type MultiInsertSeparator = 'newline' | 'space' | 'none';

const LANDSCAPE_THRESHOLD = 1.2;
const PORTRAIT_THRESHOLD = 0.83;
const DEFAULT_LANDSCAPE_RATIO = 1.6;
const DEFAULT_PORTRAIT_RATIO = 1;

const FULL_WIDTH_REPLACEMENTS: Record<string, string> = {
	'[': '【',
	']': '】',
	'(': '（',
	')': '）',
	'|': '｜',
	'\\': '／',
	'<': '＜',
	'>': '＞',
};

interface EagleItemMetadata {
	width?: number;
	height?: number;
	name?: string;
	ext?: string;
}

const numberedCounters = new Map<string, number>();

export function normalizeFileNameMode(value: unknown): FileNameMode {
	return value === 'replace' || value === 'numbered' || value === 'custom' ? value : 'strip';
}

export function normalizeImageSizeMode(value: unknown): ImageSizeMode {
	return value === 'ratio' || value === 'explicit' ? value : 'fixed';
}

export function normalizeSquareAlign(value: unknown): SquareAlign {
	return value === 'landscape' ? 'landscape' : 'portrait';
}

export function normalizeMultiInsertSeparator(value: unknown): MultiInsertSeparator {
	return value === 'newline' || value === 'space' ? value : 'none';
}

/**
 * Separator written between embeds when several Eagle items are dropped / pasted
 * in one go.
 *
 * `none` keeps every embed on the same source line, which is the only way to get
 * them to sit side by side in Live Preview - CodeMirror renders one source line
 * per block, so a `\n` always breaks the row no matter how much width is left.
 */
export function resolveInsertSeparator(settings?: MyPluginSettings | null): string {
	const mode = normalizeMultiInsertSeparator(settings?.multiInsertSeparator);
	if (mode === 'newline') {
		return '\n';
	}
	if (mode === 'space') {
		return ' ';
	}
	return '';
}

/**
 * Cleans a source file name so it can be used inside `![alt](url)` or `![[wikilink]]`.
 *
 * Source names from image boards commonly look like `[Circle] Title.webp`; Markdown
 * terminates the alt text at the first `]`, which breaks the whole embed line.
 */
export function sanitizeEmbedFileName(
	fileName: string,
	settings?: MyPluginSettings | null,
	app?: App | null,
): string {
	const mode = normalizeFileNameMode(settings?.fileNameMode);
	const raw = String(fileName ?? '');
	let base = raw;
	let suffix = '';
	const extensionMatch = raw.match(/^(.*?)(\.[A-Za-z0-9]{2,5})$/);
	if (extensionMatch) {
		base = extensionMatch[1];
		suffix = extensionMatch[2];
	}

	if (mode === 'replace') {
		base = base.replace(/[[\]()|\\<>]/g, (character) => FULL_WIDTH_REPLACEMENTS[character] ?? '');
	} else if (mode === 'numbered') {
		const activeFile = app?.workspace.getActiveFile();
		const title = activeFile?.basename || 'image';
		const nextIndex = (numberedCounters.get(title) ?? 0) + 1;
		numberedCounters.set(title, nextIndex);
		base = `${title}-${nextIndex}`;
	} else if (mode === 'custom') {
		const rule = String(settings?.fileNameCustom ?? '').trim();
		if (rule) {
			for (const pair of rule.split(',')) {
				const separatorIndex = pair.indexOf('=>');
				if (separatorIndex <= 0) {
					continue;
				}
				const from = pair.slice(0, separatorIndex).trim();
				const to = pair.slice(separatorIndex + 2);
				if (from) {
					base = base.split(from).join(to);
				}
			}
		}
		base = base.replace(/[[\]\\]/g, '');
	} else {
		base = base.replace(/[[\]\\()|<>]/g, '');
	}

	return `${base.replace(/\s+/g, ' ').trim() || 'image'}${suffix}`;
}

function readEagleItemMetadata(
	link: ResolvedEagleLink,
	settings?: MyPluginSettings | null,
): EagleItemMetadata | null {
	if (!settings) {
		return null;
	}
	const target = extractEagleLinkTarget(link.url);
	if (!target) {
		return null;
	}
	const profile = findLibraryProfileByPort(settings, target.port);
	const libraryRoot = profile?.resolvedPath || settings.libraryPath || '';
	if (!libraryRoot) {
		return null;
	}

	const metadataPath = nodePath.join(libraryRoot, 'images', `${target.itemId}.info`, 'metadata.json');
	return JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as EagleItemMetadata;
}

type ImageOrientation = 'landscape' | 'portrait' | 'square';

function resolveOrientation(link: ResolvedEagleLink, settings?: MyPluginSettings | null): ImageOrientation {
	try {
		const metadata = readEagleItemMetadata(link, settings);
		if (!metadata || !metadata.width || !metadata.height) {
			return 'portrait';
		}
		const ratio = metadata.width / metadata.height;
		if (ratio >= LANDSCAPE_THRESHOLD) {
			return 'landscape';
		}
		if (ratio <= PORTRAIT_THRESHOLD) {
			return 'portrait';
		}
		return 'square';
	} catch {
		return 'portrait';
	}
}

/**
 * Resolves the insertion width for an Eagle image.
 *
 * Eagle stores `width`/`height` in `images/<id>.info/metadata.json`, so the aspect
 * ratio is available synchronously - no async image loading is required.
 */
export function resolveInsertWidth(
	link: ResolvedEagleLink,
	settings?: MyPluginSettings | null,
	fallback?: number | undefined,
): number {
	const fallbackWidth = Number(fallback) || 0;
	const mode = normalizeImageSizeMode(settings?.imageSizeMode);
	if (mode === 'fixed') {
		return fallbackWidth;
	}

	const orientation = resolveOrientation(link, settings);

	if (mode === 'explicit') {
		const landscapeWidth = Number(settings?.landscapeWidth) || fallbackWidth;
		const portraitWidth = Number(settings?.portraitWidth) || fallbackWidth;
		if (orientation === 'landscape') {
			return landscapeWidth;
		}
		if (orientation === 'portrait') {
			return portraitWidth;
		}
		return normalizeSquareAlign(settings?.squareAlign) === 'landscape' ? landscapeWidth : portraitWidth;
	}

	const squareWidth = Number(settings?.squareSize) || fallbackWidth;
	if (squareWidth <= 0) {
		return 0;
	}
	if (orientation === 'landscape') {
		return Math.round(squareWidth * (Number(settings?.landscapeRatio) || DEFAULT_LANDSCAPE_RATIO));
	}
	if (orientation === 'portrait') {
		return Math.round(squareWidth * (Number(settings?.portraitRatio) || DEFAULT_PORTRAIT_RATIO));
	}
	return squareWidth;
}
