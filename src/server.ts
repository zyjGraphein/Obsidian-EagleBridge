import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { print } from './main';
import { isPathInsideDirectory } from './eaglePaths';
import { readEagleShortcutUrl, resolveEagleItemById } from './eagleItemResolver';
import type { ResolvedEagleLibraryProfile } from './libraryProfiles';

interface ActiveServerEntry {
	profileId: string;
	port: number;
	libraryPath: string;
	server: http.Server;
}

const activeServers = new Map<number, ActiveServerEntry>();

function getContentType(ext: string): string | null {
	switch (ext) {
		case '.jpg':
		case '.jpeg':
			return 'image/jpeg';
		case '.png':
			return 'image/png';
		case '.gif':
			return 'image/gif';
		case '.webp':
			return 'image/webp';
		case '.svg':
			return 'image/svg+xml';
		case '.pdf':
			return 'application/pdf';
		case '.mp4':
			return 'video/mp4';
		case '.mp3':
			return 'audio/mpeg';
		case '.ogg':
			return 'audio/ogg';
		case '.wav':
			return 'audio/wav';
		case '.json':
			return 'application/json';
		case '.xml':
			return 'application/xml';
		case '.ico':
			return 'image/x-icon';
		case '.txt':
			return 'text/plain';
		case '.csv':
			return 'text/csv';
		case '.html':
			return 'text/html';
		case '.css':
			return 'text/css';
		case '.js':
			return 'application/javascript';
		default:
			return null;
	}
}

function escapeHtmlAttribute(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function escapeHtmlText(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

function parseRangeHeader(rangeHeader: string, fileSize: number): { start: number; end: number } | null {
	const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
	if (!match) {
		return null;
	}

	const [, startText, endText] = match;
	if (startText === '' && endText === '') {
		return null;
	}

	let start = 0;
	let end = fileSize - 1;

	if (startText === '') {
		const suffixLength = Number.parseInt(endText, 10);
		if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
			return null;
		}

		start = Math.max(fileSize - suffixLength, 0);
	} else {
		start = Number.parseInt(startText, 10);
		if (!Number.isFinite(start) || start < 0 || start >= fileSize) {
			return null;
		}

		if (endText !== '') {
			end = Number.parseInt(endText, 10);
			if (!Number.isFinite(end)) {
				return null;
			}
		}
	}

	if (end < start) {
		return null;
	}

	return {
		start,
		end: Math.min(end, fileSize - 1),
	};
}

function streamBinaryFile(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	filePath: string,
	contentType: string,
	stats: fs.Stats,
	cacheControl?: string,
): void {
	if (cacheControl) {
		res.setHeader('Cache-Control', cacheControl);
	}

	res.setHeader('Accept-Ranges', 'bytes');
	const rangeHeader = req.headers.range;
	if (typeof rangeHeader === 'string' && rangeHeader.length > 0) {
		const parsedRange = parseRangeHeader(rangeHeader, stats.size);
		if (!parsedRange) {
			res.writeHead(416, {
				'Content-Range': `bytes */${stats.size}`,
			});
			res.end();
			return;
		}

		const { start, end } = parsedRange;
		res.writeHead(206, {
			'Content-Type': contentType,
			'Content-Length': end - start + 1,
			'Content-Range': `bytes ${start}-${end}/${stats.size}`,
		});
		fs.createReadStream(filePath, { start, end }).pipe(res);
		return;
	}

	res.writeHead(200, {
		'Content-Type': contentType,
		'Content-Length': stats.size,
	});
	fs.createReadStream(filePath).pipe(res);
}

function getCanvasImageTitle(imageUrl: string, libraryPath: string): string {
	try {
		const parsedUrl = new URL(imageUrl);
		const imagePath = decodeURIComponent(parsedUrl.pathname);
		const match = imagePath.match(/\/images\/([^/]+)\.info$/i);
		if (!match?.[1]) {
			return path.basename(imagePath) || 'Eagle Image';
		}

		const metadataPath = path.join(libraryPath, 'images', `${match[1]}.info`, 'metadata.json');
		if (!fs.existsSync(metadataPath)) {
			return match[1];
		}

		const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
		if (typeof metadata?.name === 'string' && metadata.name.trim().length > 0) {
			return metadata.name.trim();
		}

		return match[1];
	} catch {
		return 'Eagle Image';
	}
}

function renderCanvasImageEmbedPage(imageUrl: string, title: string): string {
	const safeUrl = escapeHtmlAttribute(imageUrl);
	const safeTitle = escapeHtmlText(title);
	return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${safeTitle}</title>
    <style>
        html, body {
            margin: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: #fff;
        }
        body {
            display: flex;
        }
        img {
            display: block;
            width: 100%;
            height: 100%;
            object-fit: contain;
            object-position: center;
            background: #fff;
            user-select: none;
            -webkit-user-drag: none;
        }
    </style>
</head>
<body>
    <img src="${safeUrl}" alt="">
</body>
</html>`;
}

function getCanvasResourceTitle(resourceUrl: string, fileName: string | null, libraryPath: string): string {
	const fromFileName = fileName ? path.basename(fileName, path.extname(fileName)).trim() : '';
	if (fromFileName) {
		return fromFileName;
	}

	return getCanvasImageTitle(resourceUrl, libraryPath);
}

function renderCanvasResourceEmbedPage(resourceUrl: string, title: string, fileName: string | null): string {
	const safeUrl = escapeHtmlAttribute(resourceUrl);
	const safeTitle = escapeHtmlText(title);
	const ext = (fileName ? path.extname(fileName) : '').toLowerCase();

	let body = `<iframe src="${safeUrl}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`;
	if (ext === '.pdf') {
		body = `<embed src="${safeUrl}#view=FitH" type="application/pdf">`;
	} else if (ext === '.mp4') {
		body = `<video src="${safeUrl}" controls preload="metadata" playsinline></video>`;
	} else if (ext === '.mp3' || ext === '.ogg' || ext === '.wav') {
		body = `<div class="audio-shell"><audio src="${safeUrl}" controls preload="metadata"></audio></div>`;
	}

	return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${safeTitle}</title>
    <style>
        html, body {
            margin: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: #fff;
        }
        body {
            display: flex;
            align-items: stretch;
            justify-content: stretch;
        }
        iframe, video, embed {
            display: block;
            width: 100%;
            height: 100%;
            border: 0;
            background: #fff;
        }
        video {
            object-fit: contain;
        }
        .audio-shell {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            box-sizing: border-box;
            background: linear-gradient(180deg, #fafafa 0%, #f0f0f0 100%);
        }
        audio {
            width: 100%;
            max-width: 960px;
        }
    </style>
</head>
<body>
    ${body}
</body>
</html>`;
}

function parseItemRequest(pathname: string): { itemId: string; requestedFileName: string | null } | null {
	const match = pathname.match(/^\/images\/([^/]+)\.info(?:\/([^/]+))?\/?$/i);
	if (!match?.[1]) {
		return null;
	}

	return {
		itemId: match[1],
		requestedFileName: match[2] ?? null,
	};
}

async function respondWithShortcutRedirect(res: http.ServerResponse, filePath: string): Promise<boolean> {
	const targetUrl = await readEagleShortcutUrl(filePath);
	if (targetUrl) {
		res.writeHead(302, { Location: targetUrl });
		res.end();
		return true;
	}

	res.writeHead(204);
	res.end();
	return true;
}

async function respondWithFile(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	filePath: string,
	stats: fs.Stats,
	cacheControl?: string,
): Promise<void> {
	const ext = path.extname(filePath).toLowerCase();
	if (ext === '.url') {
		await respondWithShortcutRedirect(res, filePath);
		return;
	}

	const contentType = getContentType(ext);
	if (contentType === null) {
		res.writeHead(204);
		res.end();
		return;
	}

	streamBinaryFile(req, res, filePath, contentType, stats, cacheControl);
}

async function respondWithResolvedItem(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	libraryPath: string,
	itemId: string,
	cacheControl?: string,
): Promise<boolean> {
	const resolvedItem = await resolveEagleItemById(libraryPath, itemId);
	if (!resolvedItem?.sourceFilePath) {
		return false;
	}

	const stats = await fs.promises.stat(resolvedItem.sourceFilePath).catch(() => null);
	if (!stats?.isFile()) {
		return false;
	}

	await respondWithFile(req, res, resolvedItem.sourceFilePath, stats, cacheControl);
	return true;
}

async function handleServerRequest(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	libraryPath: string,
): Promise<void> {
	const url = new URL(req.url || '/', `http://${req.headers.host}`);
	const pathname = decodeURIComponent(url.pathname);
	const filePath = path.join(libraryPath, pathname);
	const noAutoplay = url.searchParams.has('noautoplay');

	(req as any).noAutoplay = noAutoplay;

	if (pathname === '/__eaglebridge__/canvas-image') {
		const imageUrl = url.searchParams.get('src');
		if (!imageUrl) {
			res.writeHead(400, { 'Content-Type': 'text/plain' });
			res.end('Missing src parameter');
			return;
		}

		const imageTitle = getCanvasImageTitle(imageUrl, libraryPath);
		res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
		res.end(renderCanvasImageEmbedPage(imageUrl, imageTitle));
		return;
	}

	if (pathname === '/__eaglebridge__/canvas-resource') {
		const resourceUrl = url.searchParams.get('src');
		const fileName = url.searchParams.get('filename');
		if (!resourceUrl) {
			res.writeHead(400, { 'Content-Type': 'text/plain' });
			res.end('Missing src parameter');
			return;
		}

		const resourceTitle = getCanvasResourceTitle(resourceUrl, fileName, libraryPath);
		res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
		res.end(renderCanvasResourceEmbedPage(resourceUrl, resourceTitle, fileName));
		return;
	}

	const itemRequest = parseItemRequest(pathname);
	if (itemRequest && itemRequest.requestedFileName?.toLowerCase() !== 'metadata.json') {
		const servedResolvedItem = await respondWithResolvedItem(
			req,
			res,
			libraryPath,
			itemRequest.itemId,
			itemRequest.requestedFileName ? 'public, max-age=604800' : undefined,
		);
		if (servedResolvedItem) {
			return;
		}
	}

	if (!isPathInsideDirectory(filePath, path.join(libraryPath, 'images'))) {
		res.writeHead(404);
		res.end();
		return;
	}

	const stats = await fs.promises.stat(filePath).catch((error: NodeJS.ErrnoException) => error);
	if (stats instanceof Error) {
		if ((stats as NodeJS.ErrnoException).code === 'ENOENT') {
			res.writeHead(404);
			res.end();
			return;
		}

		res.writeHead(500);
		res.end('Internal Error');
		return;
	}

	if (stats.isDirectory()) {
		const itemId = parseItemRequest(pathname)?.itemId;
		if (!itemId) {
			res.writeHead(404);
			res.end();
			return;
		}

		const servedResolvedItem = await respondWithResolvedItem(req, res, libraryPath, itemId);
		if (!servedResolvedItem) {
			res.writeHead(404);
			res.end();
		}
		return;
	}

	await respondWithFile(req, res, filePath, stats, 'public, max-age=604800');
}

function createServerEntry(profile: ResolvedEagleLibraryProfile): ActiveServerEntry {
	const server = http.createServer((req, res) => {
		res.setHeader('Access-Control-Allow-Origin', '*');
		res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
		res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
		res.setHeader('Access-Control-Allow-Credentials', 'true');
		void handleServerRequest(req, res, profile.resolvedPath).catch((error) => {
			print('Server request failed:', error);
			if (!res.headersSent) {
				res.writeHead(500, { 'Content-Type': 'text/plain' });
			}
			if (!res.writableEnded) {
				res.end('Internal Server Error');
			}
		});
	});

	return {
		profileId: profile.id,
		port: profile.servePort,
		libraryPath: profile.resolvedPath,
		server,
	};
}

function closeServerEntry(entry: ActiveServerEntry): Promise<void> {
	return new Promise((resolve) => {
		entry.server.close(() => {
			print(`Server stopped at http://localhost:${entry.port}/`);
			resolve();
		});
	});
}

export async function refreshServers(profiles: ResolvedEagleLibraryProfile[]): Promise<void> {
	const nextProfiles = profiles
		.filter((profile) => profile.enabled && profile.resolvedPath)
		.sort((left, right) => left.servePort - right.servePort);

	const nextPorts = new Set(nextProfiles.map((profile) => profile.servePort));
	const closeTasks: Promise<void>[] = [];
	for (const [port, entry] of activeServers.entries()) {
		if (!nextPorts.has(port)) {
			activeServers.delete(port);
			closeTasks.push(closeServerEntry(entry));
		}
	}

	for (const profile of nextProfiles) {
		const existingEntry = activeServers.get(profile.servePort);
		if (existingEntry && existingEntry.profileId === profile.id && existingEntry.libraryPath === profile.resolvedPath) {
			continue;
		}

		if (existingEntry) {
			activeServers.delete(profile.servePort);
			closeTasks.push(closeServerEntry(existingEntry));
		}
	}

	await Promise.all(closeTasks);

	for (const profile of nextProfiles) {
		if (activeServers.has(profile.servePort)) {
			continue;
		}

		const nextEntry = createServerEntry(profile);
		nextEntry.server.listen(profile.servePort, () => {
			print(`Server is running at http://localhost:${profile.servePort}/ for ${profile.alias}`);
		});
		activeServers.set(profile.servePort, nextEntry);
	}
}

export async function stopServers(): Promise<void> {
	const closeTasks = Array.from(activeServers.values()).map((entry) => closeServerEntry(entry));
	activeServers.clear();
	await Promise.all(closeTasks);
}
