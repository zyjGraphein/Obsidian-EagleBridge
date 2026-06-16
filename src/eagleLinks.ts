import { extractEagleLinkTarget, type EagleLinkTarget } from './libraryProfiles';

const EAGLE_ITEM_INFO_URL_REGEX = /http:\/\/localhost:\d+\/images\/[^/\s?#]+\.info/gi;
const EAGLE_CANVAS_PROXY_URL_REGEX = /^http:\/\/localhost:\d+\/__eaglebridge__\/canvas-(?:image|resource)\?/i;

export function buildEagleLinkTargetKey(port: number, itemId: string): string {
	return `${port}:${itemId}`;
}

export function parseEagleLinkTargetsFromText(content: string): EagleLinkTarget[] {
	const targets = new Map<string, EagleLinkTarget>();
	let match: RegExpExecArray | null;

	while ((match = EAGLE_ITEM_INFO_URL_REGEX.exec(content)) !== null) {
		const target = extractEagleLinkTarget(match[0]);
		if (!target) {
			continue;
		}

		targets.set(buildEagleLinkTargetKey(target.port, target.itemId), target);
	}

	EAGLE_ITEM_INFO_URL_REGEX.lastIndex = 0;
	return Array.from(targets.values());
}

export function extractFirstEagleLinkTargetFromText(content: string): EagleLinkTarget | null {
	return parseEagleLinkTargetsFromText(content)[0] ?? null;
}

export function extractCanvasLinkTargets(rawUrl: string): EagleLinkTarget[] {
	const directTargets = parseEagleLinkTargetsFromText(rawUrl);
	if (directTargets.length > 0) {
		return directTargets;
	}

	if (!EAGLE_CANVAS_PROXY_URL_REGEX.test(rawUrl)) {
		return [];
	}

	try {
		const parsedUrl = new URL(rawUrl);
		const sourceUrl = parsedUrl.searchParams.get('src');
		if (!sourceUrl) {
			return [];
		}

		return parseEagleLinkTargetsFromText(decodeURIComponent(sourceUrl));
	} catch {
		return [];
	}
}
