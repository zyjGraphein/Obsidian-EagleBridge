import * as http from 'http';
import { randomBytes } from 'crypto';
import { IDENTITY_PATH, PROTOCOL, getLibraryKey, probeServer, registerServer, registryRoot } from '../eagle_to_ob/previewBridge';
import type { Socket } from 'net';
import type { ResolvedEagleLibraryProfile } from './libraryProfiles';

interface ServerEntry {
	profile: ResolvedEagleLibraryProfile;
	libraryKey: string;
	server: http.Server | null;
	sockets: Set<Socket>;
	conflict: string;
	unregister: (() => Promise<void>) | null;
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
		private discoveryRoot = registryRoot,
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
				else this.entries.set(port, { profile, libraryKey, server: null, sockets: new Set(), conflict: '', unregister: null });
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
				const remoteKey = (await probeServer(entry.profile.servePort))?.libraryKey;
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
		const instanceId = randomBytes(16).toString('hex');
		const server = http.createServer((request, response) => {
			if (request.url === IDENTITY_PATH) {
				response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
				response.end(JSON.stringify({ protocol: PROTOCOL, libraryKey: entry.libraryKey, instanceId, alias: entry.profile.alias }));
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
			try {
				entry.unregister = await registerServer(entry.libraryKey, entry.profile.servePort, instanceId, this.discoveryRoot);
			} catch (error) {
				this.reportError(error);
				this.notify(`Eagle link copying unavailable: cannot register the preview service for ${entry.profile.alias}.`);
			}
			if (this.stopped) await this.close(entry);
		} catch (error) {
			server.close();
			if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
				// Another vault may win the bind between probing and listening.
				const remoteKey = (await probeServer(entry.profile.servePort))?.libraryKey;
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
		const unregister = entry.unregister;
		entry.unregister = null;
		if (unregister) {
			try { await unregister(); } catch (error) { this.reportError(error); }
		}
		if (!server) return;
		await new Promise<void>(resolve => {
			server.close(() => resolve());
			// Active video streams and keep-alive connections must not hold the port open.
			for (const socket of entry.sockets) socket.destroy();
			entry.sockets.clear();
		});
	}
}
