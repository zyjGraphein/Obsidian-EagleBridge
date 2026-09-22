import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { build } from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'eaglebridge-servers-'));
const children = [];
const managers = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = (resolvedPath, servePort) => ({ id: 'test', alias: 'Test', enabled: true, resolvedPath, servePort });
const listen = async server => { server.listen(0); await once(server, 'listening'); return server.address().port; };
const close = server => new Promise(resolve => server.close(resolve));
async function freePort() { const server = http.createServer(); const port = await listen(server); await close(server); return port; }
function get(port, pathname = '/owner') {
    return new Promise((resolve, reject) => {
        const req = http.get({ hostname: 'localhost', port, path: pathname, agent: false }, res => {
            let body = '';
            res.on('data', data => { body += data; });
            res.on('end', () => resolve(body));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(1000, () => req.destroy(new Error('request timed out')));
    });
}
async function until(check) {
    const deadline = Date.now() + 6000;
    do { if (await check()) return; await delay(40); } while (Date.now() < deadline);
    throw new Error('Timed out waiting for server takeover');
}
let sequence = 0;
function rpc(child, method, profiles) {
    return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timeout = setTimeout(() => { child.off('message', onMessage); reject(new Error(`IPC timeout: ${method}`)); }, 8000);
        const onMessage = message => {
            if (message.id !== id) return;
            clearTimeout(timeout);
            child.off('message', onMessage);
            message.error ? reject(new Error(message.error)) : resolve(message);
        };
        child.on('message', onMessage);
        child.send({ id, method, profiles });
    });
}

let blocker;
try {
    const library = path.join(temp, 'Library.library');
    const otherLibrary = path.join(temp, 'Other.library');
    const alias = path.join(temp, 'Alias.library');
    await fs.mkdir(library);
    await fs.mkdir(otherLibrary);
    await fs.symlink(library, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const bundle = path.join(temp, 'manager.cjs');
    await build({ entryPoints: [path.join(repo, 'src/previewServerManager.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs' });
    const worker = path.join(temp, 'worker.cjs');
    await fs.writeFile(worker, `
        const { PreviewServerManager } = require('./manager.cjs');
        const notices = [], errors = [];
        const manager = new PreviewServerManager((profile, req, res) => {
            if (req.url === '/stream') { res.writeHead(200); res.write('video'); }
            else res.end(String(process.pid));
        }, message => notices.push(message), error => errors.push(String(error)), 100);
        process.on('message', async ({id, method, profiles}) => {
            try {
                if (method === 'refresh') await manager.refresh(profiles);
                if (method === 'stop') await manager.stop();
                process.send({id, notices, errors});
            } catch (error) { process.send({id, error:String(error)}); }
        });
    `);
    for (let i = 0; i < 3; i++) children.push(fork(worker, [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'], windowsHide: true }));
    const port = await freePort();
    const startups = await Promise.all(children.map((child, i) => rpc(child, 'refresh', [profile(i === 1 ? alias : library, port)])));
    for (const result of startups) { assert.deepEqual(result.notices, []); assert.deepEqual(result.errors, []); }
    const ownerPid = Number(await get(port));
    assert(children.some(child => child.pid === ownerPid));
    const identity = JSON.parse(await get(port, '/__eaglebridge__/server-info'));
    assert.equal(identity.protocol, 'EagleBridge-preview-v1');
    assert(!JSON.stringify(identity).includes(library), 'Probe must not reveal local paths');

    const owner = children.find(child => child.pid === ownerPid);
    const ownerExit = once(owner, 'exit');
    owner.kill();
    await ownerExit;
    await until(async () => { try { return Number(await get(port)) !== ownerPid; } catch { return false; } });
    const nextOwnerPid = Number(await get(port));
    const nextOwner = children.find(child => child.pid === nextOwnerPid);
    const follower = children.find(child => child.pid !== ownerPid && child.pid !== nextOwnerPid);
    assert(nextOwner && follower);

    await rpc(follower, 'stop');
    assert.equal(Number(await get(port)), nextOwnerPid, 'Stopping a follower must not stop shared previews');
    // Restart an independent instance to test a graceful handoff with an active video stream.
    const replacement = fork(worker, [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'], windowsHide: true });
    children.push(replacement);
    await rpc(replacement, 'refresh', [profile(library, port)]);
    const stream = http.get(`http://localhost:${port}/stream`);
    stream.on('error', () => {});
    const [response] = await once(stream, 'response');
    response.on('error', () => {});
    response.resume();
    await rpc(nextOwner, 'stop');
    await until(async () => { try { return Number(await get(port)) === replacement.pid; } catch { return false; } });
    stream.destroy();
    const status = await rpc(replacement, 'stop');
    assert.deepEqual(status.notices, []);
    assert.deepEqual(status.errors, []);
    const released = http.createServer();
    released.listen(port); await once(released, 'listening'); await close(released);

    const { PreviewServerManager } = createRequire(import.meta.url)(bundle);
    const make = () => {
        const notices = [], errors = [];
        const manager = new PreviewServerManager((p, req, res) => res.end(p.resolvedPath), message => notices.push(message), error => errors.push(error), 100);
        managers.push(manager);
        return { manager, notices, errors };
    };
    const a = make(), b = make();
    await a.manager.refresh([profile(library, port)]);
    await b.manager.refresh([profile(otherLibrary, port)]);
    assert.equal(b.notices.length, 1);
    assert.match(b.notices[0], /another Eagle library/);
    await delay(350);
    assert.equal(b.notices.length, 1, 'Do not repeatedly show conflict notices');
    await a.manager.stop();
    await until(async () => { try { return await get(port) === otherLibrary; } catch { return false; } });
    await b.manager.stop();

    blocker = http.createServer((req, res) => { res.end('unrelated application'); });
    blocker.listen(port); await once(blocker, 'listening');
    const c = make();
    await c.manager.refresh([profile(library, port)]);
    assert.equal(c.notices.length, 1);
    assert.match(c.notices[0], /another application/);
    assert.equal(await get(port), 'unrelated application');
    await close(blocker); blocker = null;
    await until(async () => { try { return await get(port) === library; } catch { return false; } });
    const port2 = await freePort();
    await Promise.all([c.manager.refresh([profile(library, port2)]), c.manager.refresh([profile(otherLibrary, port2)])]);
    assert.equal(await get(port2), otherLibrary, 'Last settings refresh must win');
    await assert.rejects(get(port));
    await Promise.all([c.manager.refresh([profile(library, port)]), c.manager.stop()]);
    await delay(250);
    await assert.rejects(get(port));
    await assert.rejects(get(port2));
    for (const item of [a, b, c]) assert.deepEqual(item.errors, []);
    console.log('Preview servers passed: 3 processes, alias reuse, crash/graceful takeover, active streams, conflicts, concurrent refresh/unload, port release.');
} finally {
    await Promise.all(managers.map(manager => manager.stop()));
    if (blocker) await close(blocker);
    await Promise.all(children.map(async child => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const exited = once(child, 'exit'); child.kill(); await exited;
    }));
    await fs.rm(temp, { recursive: true, force: true });
}
