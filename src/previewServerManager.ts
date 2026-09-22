import * as http from 'http';
import * as fs from 'fs';
import { createHash } from 'crypto';
import type { Socket } from 'net';
import type { ResolvedEagleLibraryProfile } from './libraryProfiles';

const IDENTITY_PATH = '/__eaglebridge__/server-info';
const PROTOCOL = 'EagleBridge-preview-v1';

interface ServerEntry {
	profile: ResolvedEagleLibraryProfile;
	libraryKey: string;
	server: http.Server | null;
	sockets: Set<Socket>;
	conflict: string;
}

async function getLibraryKey(libraryPath: string): Promise<string> {
	const [realPath, stats] = await Promise.all([
		fs.promises.realpath(libraryPath),
		fs.promises.stat(libraryPath, { bigint: true }),
	]);
	// File identity also recognizes macOS path aliases and Windows junctions.
	const identity = stats.ino !== BigInt(0)
		? `${stats.dev}:${stats.ino}`
		: process.platform === 'win32' ? realPath.toLowerCase() : realPath;
	return createHash('sha256').update(identity).digest('hex');
}

function probeServer(port: number): Promise<string | null> {
	return new Promise((resolve) => {
		const request = http.get({ hostname: 'localhost', port, path: IDENTITY_PATH, agent: false }, (response) => {
			let body = '';
			response.setEncoding('utf8');
			response.on('data', (chunk: string) => {
				body += chunk;
				if (body.length > 4096) request.destroy();
			});
			response.on('error', () => resolve(null));
			response.on('end', () => {
				try {
					const info = JSON.parse(body);
					resolve(response.statusCode === 200 && info.protocol === PROTOCOL && typeof info.libraryKey === 'string'
						? info.libraryKey : null);
				} catch { resolve(null); }
			});
		});
		const timeout = setTimeout(() => request.destroy(), 1500);
		request.on('error', () => resolve(null));
		request.on('close', () => { clearTimeout(timeout); resolve(null); });
	});
}

/** Each vault owns its listeners; other vaults reuse them and take over after shutdown. */
export class PreviewServerManager {
	private entries = new Map<number, ServerEntry>();
	private queue: Promise<void> = Promise.resolve();
	private timer: ReturnType<typeof setTimeout> | null = null;
	private stopped = false;

	constructor(
		private serve: (profile: ResolvedEagleLibraryProfile, request: http.IncomingMessage, response: http.ServerResponse) => void,
		private notify: (message: string) => void,
		private reportError: (error: unknown) => void,
		private retryMs = 2000,
	) {}

	refresh(profiles: ResolvedEagleLibraryProfile[]): Promise<void> {
		const snapshot = profiles.filter(profile => profile.enabled && profile.resolvedPath).map(profile => ({ ...profile }));
		return this.enqueue(async () => {
			if (this.stopped) return;
			const desired = new Map<number, { profile: ResolvedEagleLibraryProfile; libraryKey: string }>();
			for (const profile of snapshot) {
				try {
					desired.set(profile.servePort, { profile, libraryKey: await getLibraryKey(profile.resolvedPath) });
				} catch (error) {
					this.reportError(error);
					this.notify(`Eagle preview unavailable: cannot access ${profile.alias}. Check its library path.`);
				}
			}
			for (const [port, entry] of this.entries) {
				if (desired.get(port)?.libraryKey !== entry.libraryKey) {
					await this.close(entry);
					this.entries.delete(port);
				}
			}
			for (const [port, { profile, libraryKey }] of desired) {
				const existing = this.entries.get(port);
				if (existing) existing.profile = profile;
				else this.entries.set(port, { profile, libraryKey, server: null, sockets: new Set(), conflict: '' });
			}
			await this.maintain();
		});
	}

	stop(): Promise<void> {
		this.stopped = true;
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		return this.enqueue(async () => {
			await Promise.all(Array.from(this.entries.values(), entry => this.close(entry)));
			this.entries.clear();
		});
	}

	private enqueue(work: () => Promise<void>): Promise<void> {
		const next = this.queue.then(work);
		this.queue = next.catch(this.reportError);
		return this.queue;
	}

	private async maintain(): Promise<void> {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		try {
			for (const entry of this.entries.values()) {
				if (this.stopped) break;
				if (entry.server) continue;
				const remoteKey = await probeServer(entry.profile.servePort);
				if (remoteKey === entry.libraryKey) {
					entry.conflict = '';
					continue;
				}
				if (remoteKey) this.warnConflict(entry, true);
				else if (!this.stopped) await this.start(entry);
			}
		} finally {
			if (!this.stopped && this.entries.size) {
				this.timer = setTimeout(() => { void this.enqueue(() => this.maintain()); }, this.retryMs);
			}
		}
	}

	private async start(entry: ServerEntry): Promise<void> {
		const server = http.createServer((request, response) => {
			if (request.url === IDENTITY_PATH) {
				response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
				response.end(JSON.stringify({ protocol: PROTOCOL, libraryKey: entry.libraryKey }));
				return;
			}
			this.serve(entry.profile, request, response);
		});
		server.on('connection', socket => {
			entry.sockets.add(socket);
			socket.once('close', () => entry.sockets.delete(socket));
		});
		try {
			await new Promise<void>((resolve, reject) => {
				server.once('error', reject);
				server.listen(entry.profile.servePort, () => { server.off('error', reject); resolve(); });
			});
			entry.server = server;
			entry.conflict = '';
			server.on('error', error => {
				this.reportError(error);
				void this.enqueue(() => this.close(entry));
			});
			if (this.stopped) await this.close(entry);
		} catch (error) {
			server.close();
			if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
				// Another vault may win the bind between probing and listening.
				const remoteKey = await probeServer(entry.profile.servePort);
				if (remoteKey !== entry.libraryKey) this.warnConflict(entry, Boolean(remoteKey));
			} else {
				this.reportError(error);
				this.warnConflict(entry, false);
			}
		}
	}

	private warnConflict(entry: ServerEntry, differentLibrary: boolean): void {
		const reason = differentLibrary ? 'another Eagle library' : 'another application or an older EagleBridge instance';
		if (entry.conflict === reason || this.stopped) return;
		entry.conflict = reason;
		this.notify(`Eagle preview port ${entry.profile.servePort} for ${entry.profile.alias} is used by ${reason}. Use the same port for the same library across vaults; assign different ports to different libraries. Update/reload EagleBridge in all open vaults if needed.`);
	}

	private async close(entry: ServerEntry): Promise<void> {
		const server = entry.server;
		entry.server = null;
		if (!server) return;
		await new Promise<void>(resolve => {
			server.close(() => resolve());
			// Active video streams and keep-alive connections must not hold the port open.
			for (const socket of entry.sockets) socket.destroy();
			entry.sockets.clear();
		});
	}
}
