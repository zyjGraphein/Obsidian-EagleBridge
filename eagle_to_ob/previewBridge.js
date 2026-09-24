// Shared by the Obsidian server and the standalone Eagle inspector.
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { createHash } = require('crypto');

const IDENTITY_PATH = '/__eaglebridge__/server-info';
const PROTOCOL = 'EagleBridge-preview-v1';
const registryRoot = path.join(os.homedir(), '.eaglebridge', 'preview-servers');

/** @param {string} libraryPath */
async function getLibraryKey(libraryPath) {
    const [realPath, stats] = await Promise.all([
        fs.promises.realpath(libraryPath),
        fs.promises.stat(libraryPath, { bigint: true }),
    ]);
    // File identity recognizes macOS aliases and Windows junctions.
    const identity = stats.ino !== BigInt(0) ? `${stats.dev}:${stats.ino}`
        : process.platform === 'win32' ? realPath.toLowerCase() : realPath;
    return createHash('sha256').update(identity).digest('hex');
}

/** @typedef {{ protocol: string, libraryKey: string, instanceId: string, alias: string }} ServerInfo */
/** @param {number} port @returns {Promise<ServerInfo | null>} */
function probeServer(port) {
    return new Promise(resolve => {
        const request = http.get({ hostname: 'localhost', port, path: IDENTITY_PATH, agent: false }, response => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => {
                body += chunk;
                if (body.length > 4096) request.destroy();
            });
            response.on('error', () => resolve(null));
            response.on('end', () => {
                try {
                    const info = JSON.parse(body);
                    resolve(response.statusCode === 200 && info.protocol === PROTOCOL && typeof info.libraryKey === 'string'
                        ? info : null);
                } catch { resolve(null); }
            });
        });
        const timeout = setTimeout(() => request.destroy(), 1500);
        request.on('error', () => resolve(null));
        request.on('close', () => { clearTimeout(timeout); resolve(null); });
    });
}

/** @param {string} libraryKey @param {number} port @param {string} instanceId */
async function registerServer(libraryKey, port, instanceId, root = registryRoot) {
    const directory = path.join(root, libraryKey);
    await fs.promises.mkdir(directory, { recursive: true });
    // A unique filename prevents an old owner's cleanup from removing its successor.
    const file = path.join(directory, `${port}-${instanceId}.json`);
    await fs.promises.writeFile(file, JSON.stringify({ port, instanceId }), { mode: 0o600 });
    return async () => {
        try { await fs.promises.unlink(file); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    };
}

/** @typedef {{ port: number, libraryKey: string, instanceId: string, alias: string }} PreviewService */
/** @param {string} libraryPath @returns {Promise<PreviewService[]>} */
async function discoverServers(libraryPath, root = registryRoot) {
    const libraryKey = await getLibraryKey(libraryPath);
    let filenames;
    try { filenames = await fs.promises.readdir(path.join(root, libraryKey)); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const candidates = new Map();
    for (const name of filenames) {
        const match = /^(\d{1,5})-([a-f0-9]{32})\.json$/.exec(name);
        if (!match) continue;
        const port = Number(match[1]);
        if (port < 1 || port > 65535) continue;
        if (!candidates.has(port)) candidates.set(port, new Set());
        candidates.get(port).add(match[2]);
    }
    const services = await Promise.all([...candidates].map(async ([port, instances]) => {
        const info = await probeServer(port);
        // Ignore stale registrations, unrelated apps and ports reused by another library.
        return info?.libraryKey === libraryKey && instances.has(info.instanceId)
            ? { port, libraryKey, instanceId: info.instanceId, alias: String(info.alias || '') } : null;
    }));
    return services.filter(service => service !== null).sort((a, b) => a.port - b.port);
}

module.exports = { IDENTITY_PATH, PROTOCOL, registryRoot, getLibraryKey, probeServer, registerServer, discoverServers };
