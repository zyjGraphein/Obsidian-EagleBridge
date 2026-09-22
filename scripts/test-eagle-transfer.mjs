import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'eaglebridge-transfer-test-'));
const originalFetch = globalThis.fetch;
const notices = [];
globalThis.eagleTestNotices = notices;
const stubs = {
    './main': 'export const print = () => {};',
    obsidian: 'export class Notice { constructor(message) { globalThis.eagleTestNotices.push(message); } }',
    electron: 'export const webUtils = { getPathForFile: file => file.nativePath || "" };',
    '@codemirror/view': 'export class EditorView {}',
    './synchronizedpagetabs': 'export const getCurrentPageTags = () => [];',
    './uploadTargetModal': 'export const chooseUploadTargetProfile = async (_, profiles) => profiles[0];',
};

async function bundle(entry) {
    const outfile = path.join(temp, `${entry}.cjs`);
    await esbuild.build({
        entryPoints: [path.join(repo, 'src', `${entry}.ts`)], outfile,
        bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
        plugins: [{ name: 'obsidian-test-host', setup(build) {
            build.onResolve({ filter: /.*/ }, args => args.path in stubs ? { path: args.path, namespace: 'stub' } : undefined);
            build.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path] }));
        } }],
    });
    return require(outfile);
}

function profile(id, resolvedPath, servePort = 6060) {
    return { id, alias: id, paths: [resolvedPath], resolvedPath, servePort, enabled: true, folderId: '' };
}

try {
    const api = await bundle('eagleApi');
    const transfer = await bundle('urlHandler');
    const paths = await bundle('eaglePaths');
    const libraries = await bundle('libraryProfiles');
    const library = path.join(temp, 'External disk', 'Café.library');
    await fs.promises.mkdir(library, { recursive: true });
    const target = profile('external', library);
    const plugin = {
        settings: { libraryProfiles: [target], defaultUploadTargetId: target.id, externalUploadMode: 'fixed',
            upload: { enabled: true, markdown: true, canvas: true, image: true, other: true }, imageSize: 300 },
        app: {},
    };
    const calls = [];
    let activeLibrary = library;
    let libraryInfoUnavailable = false;
    let uploadResponse = { status: 'success', data: ['NEW_ID'] };
    let listResponses = [];
    globalThis.fetch = async (url, options = {}) => {
        const parsed = new URL(url);
        const body = options.body ? JSON.parse(options.body) : null;
        calls.push({ endpoint: parsed.pathname, query: parsed.searchParams, body });
        let result;
        if (parsed.pathname.endsWith('/library/info')) result = { status: 'success', data: libraryInfoUnavailable ? {} : { path: activeLibrary } };
        else if (parsed.pathname.endsWith('/library/switch')) { activeLibrary = body.libraryPath; result = { status: 'success' }; }
        else if (parsed.pathname.endsWith('/item/addFromPaths') || parsed.pathname.endsWith('/item/addBookmark')) {
            result = typeof uploadResponse === 'function' ? uploadResponse(body) : uploadResponse;
        } else if (parsed.pathname.endsWith('/item/list')) result = { status: 'success', data: listResponses.shift() ?? [] };
        else throw new Error(`Unexpected API call: ${url}`);
        return { ok: true, json: async () => result };
    };

    // No images/ directory or metadata exists: a successful API ID must suffice.
    // Fail on any old scanning/watching path instead of merely timing the test.
    const originals = { readdir: fs.promises.readdir, stat: fs.promises.stat, watch: fs.watch };
    try {
        fs.promises.readdir = fs.promises.stat = fs.watch = () => { throw new Error('Unexpected library scan/watch'); };
        const item = await api.uploadFileToLibrary(path.join(temp, 'picture.png'), target, ['tag']);
        assert.deepEqual(item, { itemId: 'NEW_ID', fileName: 'picture.png' });
        const post = calls.find(call => call.body?.items);
        assert.equal(post.body.items[0].name, 'picture');
        assert.deepEqual(post.body.items[0].tags, ['tag']);
        assert.equal(calls.some(call => call.endpoint.endsWith('/item/list')), false);
    } finally {
        fs.promises.readdir = originals.readdir;
        fs.promises.stat = originals.stat;
        fs.watch = originals.watch;
    }

    // Test the actual Markdown drop handler through to insertion.
    const files = [{ name: 'picture.png', nativePath: path.join(temp, 'picture.png') }];
    const dataTransfer = { files, items: [], getData: () => '' };
    const event = { dataTransfer, clientX: 1, clientY: 1, view: { document: {} },
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, stopImmediatePropagation() {} };
    let inserted = '';
    await transfer.handleDropEvent(event, { replaceSelection: value => { inserted = value; } }, 6060, plugin);
    assert.equal(event.defaultPrevented, true);
    assert.equal(inserted, '![picture.png|300](http://localhost:6060/images/NEW_ID.info)');

    // HTTP 200 with Eagle's error status must not look like a successful import.
    uploadResponse = { status: 'error', data: ['WRONG_ID'] };
    await assert.rejects(api.uploadFileToLibrary('bad.png', target, []), /EAGLE_API_.*_FAILED/);
    uploadResponse = { status: 'success' };
    const postCount = () => calls.filter(call => call.endpoint.endsWith('/item/addFromPaths')).length;
    const beforeMissingId = postCount();
    await assert.rejects(api.uploadFileToLibrary('no-id.png', target, []), /UPLOADED_ITEM_ID_MISSING/);
    assert.equal(postCount() - beforeMissingId, 1, 'Never re-import a file when the ID is missing');

    // A later failed upload must not discard the first successful link.
    uploadResponse = body => body.items[0].name === 'bad' ? { status: 'error' } : { status: 'success', data: ['GOOD_ID'] };
    const partial = await transfer.resolveTransferFilesToEagleLinks([
        { name: 'good.png', nativePath: path.join(temp, 'good.png') },
        { name: 'bad.png', nativePath: path.join(temp, 'bad.png') },
    ], plugin, 'markdown');
    assert.equal(partial.length, 1);
    assert.match(partial[0].url, /GOOD_ID\.info$/);
    assert.ok(notices.some(notice => notice.includes('1 file(s) linked; 1 file(s)')));

    // A junction/symlink spelling of the same external library must reuse its ID.
    const alias = path.join(temp, 'Library alias');
    await fs.promises.symlink(library, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const source = path.join(alias, 'images', 'EXISTING.info', 'photo.png');
    await fs.promises.mkdir(path.dirname(source), { recursive: true });
    await fs.promises.writeFile(source, 'test');
    const beforeReuse = calls.length;
    const reused = await transfer.resolveFilePathToEagleLink(source, plugin);
    assert.match(reused.url, /EXISTING\.info$/);
    assert.equal(calls.length, beforeReuse, 'Existing library file must not call the upload API');
    assert.equal(paths.getEagleLibraryItemPath(source, library), 'images/EXISTING.info');
    const unknownSource = path.join(temp, 'Other.library', 'images', 'OTHER.info', 'photo.png');
    await assert.rejects(transfer.resolveFilePathToEagleLink(unknownSource, plugin), /EAGLE_SOURCE_LIBRARY_NOT_CONFIGURED/);
    assert.equal(calls.length, beforeReuse, 'Unconfigured Eagle source must not be duplicated');
    assert.equal(libraries.findLibraryProfileByFilePath(plugin.settings, path.join(library, 'unrelated.png')), null);

    // Bookmark-only responses use the API index, excluding pre-existing IDs.
    const bookmark = { id: 'OLD', name: 'example.com', url: 'https://example.com/page', ext: 'url', modificationTime: Date.now() };
    listResponses = [[bookmark], [bookmark], [bookmark, { ...bookmark, id: 'BOOKMARK_NEW' }]];
    uploadResponse = { status: 'success' };
    const uploadedBookmark = await api.uploadUrlToLibrary(bookmark.url, target, []);
    assert.equal(uploadedBookmark.itemId, 'BOOKMARK_NEW');
    assert.ok(calls.filter(call => call.endpoint.endsWith('/item/list')).every(call => call.query.get('limit') === '100'));
    listResponses = [[], [{ ...bookmark, id: 'AMBIGUOUS1', modificationTime: Date.now() }, { ...bookmark, id: 'AMBIGUOUS2', modificationTime: Date.now() }]];
    await assert.rejects(api.uploadUrlToLibrary(bookmark.url, target, []), /UPLOADED_ITEM_AMBIGUOUS/);

    // Never import until the requested library is confirmed, even after switch succeeds.
    libraryInfoUnavailable = true;
    const beforeUnconfirmed = postCount();
    const realSetTimeout = globalThis.setTimeout;
    try {
        globalThis.setTimeout = callback => realSetTimeout(callback, 0);
        await assert.rejects(api.uploadFileToLibrary('unconfirmed.png', target, []), /EAGLE_LIBRARY_SWITCH_TIMEOUT/);
        assert.equal(postCount(), beforeUnconfirmed);
    } finally {
        globalThis.setTimeout = realSetTimeout;
        libraryInfoUnavailable = false;
    }

    // Concurrent uploads must keep each returned ID in the intended library context.
    uploadResponse = { status: 'success', data: ['QUEUED'] };
    const other = profile('second', path.join(temp, 'Second.library'), 6061);
    const beforeQueue = calls.length;
    await Promise.all([api.uploadFileToLibrary('one.png', target, []), api.uploadFileToLibrary('two.png', other, [])]);
    const queueCalls = calls.slice(beforeQueue).filter(call => call.body);
    assert.deepEqual(queueCalls.map(call => call.endpoint), ['/api/item/addFromPaths', '/api/library/switch', '/api/item/addFromPaths']);
    assert.equal(queueCalls[1].body.libraryPath, other.resolvedPath);

    // Execute macOS path semantics on every test host, including Windows.
    const macSource = await fs.promises.readFile(path.join(repo, 'src', 'eaglePaths.ts'), 'utf8');
    const macBuild = await esbuild.transform(macSource, { loader: 'ts', format: 'cjs', define: { 'process.platform': '"darwin"' } });
    const macModule = { exports: {} };
    const identities = new Map([
        ['/Volumes/Design/Café.library', { dev: 1n, ino: 10n }],
        ['/volumes/design/Cafe\u0301.library', { dev: 1n, ino: 10n }],
        ['/Volumes/Design/CAFÉ.library', { dev: 1n, ino: 11n }],
    ]);
    new Function('require', 'module', 'exports', macBuild.code)(name => name === 'path' ? path.posix : {
        statSync: name => { if (!identities.has(name)) throw new Error('ENOENT'); return identities.get(name); },
    }, macModule, macModule.exports);
    const macPaths = macModule.exports;
    assert.equal(macPaths.getEagleLibraryItemPath('/volumes/design/Cafe\u0301.library/images/MAC.info/图片.png', '/Volumes/Design/Café.library'), 'images/MAC.info');
    assert.equal(macPaths.getEagleLibraryItemPath('/Volumes/Design/CAFÉ.library/images/MAC.info/图片.png', '/Volumes/Design/Café.library'), null, 'Respect case-sensitive Mac volumes');
    assert.equal(macPaths.getEagleLibraryItemPath('/Volumes/Design/Café.library-copy/images/MAC.info/photo.png', '/Volumes/Design/Café.library'), null);

    // Preview startup errors must be reported, and reloads must release servers.
    const servers = await bundle('server');
    const blocker = http.createServer();
    await new Promise(resolve => blocker.listen(0, resolve));
    const port = blocker.address().port;
    try {
        await servers.refreshServers([{ ...target, servePort: port }]);
        assert.ok(notices.some(notice => notice.includes(`could not listen on port ${port}`)));
    } finally {
        await new Promise(resolve => blocker.close(resolve));
    }
    try {
        await fs.promises.writeFile(path.join(path.dirname(source), 'metadata.json'), JSON.stringify({ name: 'photo', ext: 'png' }));
        for (let iteration = 0; iteration < 3; iteration += 1) {
            await servers.refreshServers([{ ...target, servePort: port }]);
            const preview = await originalFetch(`http://localhost:${port}/images/EXISTING.info`);
            assert.equal(preview.status, 200);
            assert.equal(await preview.text(), 'test');
            await servers.stopServers();
        }
        const videoDir = path.join(library, 'images', 'VIDEO.info');
        await fs.promises.mkdir(videoDir);
        await fs.promises.writeFile(path.join(videoDir, 'metadata.json'), JSON.stringify({ name: 'video', ext: 'mp4' }));
        await fs.promises.writeFile(path.join(videoDir, 'video.mp4'), Buffer.alloc(2 * 1024 * 1024, 7));
        await servers.refreshServers([{ ...target, servePort: port }]);
        const videoUrl = `http://localhost:${port}/images/VIDEO.info`;
        const originalCreateStream = fs.createReadStream;
        const openedStreams = [];
        fs.createReadStream = (...args) => { const stream = originalCreateStream(...args); openedStreams.push(stream); return stream; };
        try {
            const head = await originalFetch(videoUrl, { method: 'HEAD' });
            assert.equal(head.status, 200);
            assert.equal(head.headers.get('content-length'), String(2 * 1024 * 1024));
            assert.equal(openedStreams.length, 0, 'HEAD must not read a large video');
            const range = await originalFetch(videoUrl, { headers: { Range: 'bytes=10-19' } });
            assert.equal(range.status, 206);
            assert.equal(range.headers.get('content-range'), `bytes 10-19/${2 * 1024 * 1024}`);
            assert.equal((await range.arrayBuffer()).byteLength, 10);
            await new Promise((resolve, reject) => {
                const request = http.get(videoUrl, response => {
                    response.once('data', () => { response.destroy(); resolve(); });
                    response.once('error', reject);
                });
                request.once('error', reject);
            });
            for (let attempt = 0; attempt < 40 && openedStreams.some(stream => !stream.closed); attempt++) {
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            assert.ok(openedStreams.every(stream => stream.closed), 'Aborted previews must close file streams');
        } finally {
            fs.createReadStream = originalCreateStream;
        }
        assert.equal(process._getActiveHandles().filter(handle => handle.constructor.name === 'FSWatcher').length, 0);
    } finally {
        await servers.stopServers();
    }

    console.log('Transfer tests passed: API IDs without disk events, Markdown insertion, errors, partial success, aliases, unconfigured libraries, bookmarks, library queue, macOS path identity, preview/reload lifecycle, video HEAD/Range/abort cleanup.');
} finally {
    globalThis.fetch = originalFetch;
    delete globalThis.eagleTestNotices;
    assert.equal(path.dirname(temp), os.tmpdir());
    assert.ok(path.basename(temp).startsWith('eaglebridge-transfer-test-'));
    await fs.promises.rm(temp, { recursive: true, force: true });
}
