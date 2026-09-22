import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'eaglebridge-batch-test-'));
const notices = [];
class TFile {
    constructor(filePath) { this.path = filePath; this.name = path.basename(filePath); this.extension = path.extname(filePath).slice(1); }
}
class FileSystemAdapter { constructor(base) { this.base = base; } getBasePath() { return this.base; } }
class Notice {
    constructor(message) { this.setMessage(message); }
    setMessage(message) { notices.push(message); return this; }
    hide() {}
}
globalThis.batchTestHost = { TFile, FileSystemAdapter, Notice, Modal: class { open() {} }, App: class {}, Setting: class {} };
const stubs = {
    obsidian: 'export const {TFile,FileSystemAdapter,Notice,Modal,App,Setting} = globalThis.batchTestHost;',
    './urlHandler': 'export const resolveFilePathToEagleLink = (...args) => globalThis.batchResolve(...args);',
    './synchronizedpagetabs': 'export const getCurrentPageTags = () => ["source-page-tag"];',
};

let fixtureCount = 0;
async function fixture(options = {}) {
    const root = path.join(temp, `case-${fixtureCount++}`);
    const library = path.join(root, 'Eagle.library');
    await fs.promises.mkdir(library, { recursive: true });
    const files = new Map();
    const contents = new Map();
    const caches = new Map();
    const listeners = new Map();
    const trashed = [];
    const calls = [];
    const emit = (event, file) => { for (const ref of listeners.get(event) ?? []) ref.callback(file); };
    async function add(filePath, content = '') {
        const file = new TFile(filePath);
        files.set(filePath, file);
        contents.set(filePath, content);
        await fs.promises.mkdir(path.dirname(path.join(root, filePath)), { recursive: true });
        await fs.promises.writeFile(path.join(root, filePath), content);
        if (file.extension === 'md') caches.set(filePath, { links: [], embeds: [] });
        return file;
    }
    const noteText = options.text ?? '---\ntitle: video data\nlikes: 123\n---\n![[clip.mp4]]\n[观看视频](clip.mp4)';
    const note = await add('note.md', noteText);
    await add('clip.mp4', 'VIDEO-CONTENT');
    const cache = { links: [], embeds: [], frontmatter: options.properties ?? { title: 'video data', likes: 123 } };
    for (const match of noteText.matchAll(/!?\[\[([^\]|]+)(?:\|[^\]]*)?\]\]|!?\[[^\]]*\]\(([^)]+)\)/g)) {
        const ref = { link: match[1] ?? match[2], position: { start: { offset: match.index }, end: { offset: match.index + match[0].length } } };
        (match[0].startsWith('!') ? cache.embeds : cache.links).push(ref);
        if (!files.has(ref.link)) await add(ref.link, 'SECOND-VIDEO');
    }
    caches.set(note.path, cache);
    const app = {
        workspace: { getActiveFile: () => note },
        metadataCache: {
            getFileCache: file => caches.get(file.path),
            getFirstLinkpathDest: link => files.get(link) ?? null,
        },
        vault: {
            adapter: new FileSystemAdapter(root),
            getFiles: () => [...files.values()],
            getMarkdownFiles: () => [...files.values()].filter(file => file.extension === 'md'),
            read: async file => { assert.notEqual(file.extension, 'mp4', 'Never buffer videos through vault.read'); return contents.get(file.path); },
            process: async (file, callback) => { contents.set(file.path, callback(contents.get(file.path))); emit('modify', file); },
            trash: async file => { assert.match(contents.get(note.path), /localhost:/); trashed.push(file.path); emit('delete', file); },
            on: (event, callback) => { const ref = { event, callback }; const refs = listeners.get(event) ?? new Set(); refs.add(ref); listeners.set(event, refs); return ref; },
            offref: ref => listeners.get(ref.event)?.delete(ref),
        },
    };
    const plugin = { app, registerEvent() {}, settings: { libraryProfiles: [{ id: 'test', paths: [library], servePort: 6060, enabled: true }] } };
    globalThis.batchResolve = async (source, _plugin, _target, tags) => {
        calls.push(source);
        assert.deepEqual(tags, ['source-page-tag']);
        await options.duringUpload?.({ app, note, add, emit, contents, files });
        if (path.basename(source) === options.failFile) throw new Error('TEST_IMPORT_FAILED');
        const id = `ITEM_${calls.length}`;
        const info = path.join(library, 'images', `${id}.info`);
        await fs.promises.mkdir(info, { recursive: true });
        await fs.promises.writeFile(path.join(info, 'metadata.json'), JSON.stringify({ name: path.basename(source, '.mp4'), ext: 'mp4' }));
        if (options.incompleteCopy) await fs.promises.writeFile(path.join(info, path.basename(source)), 'short');
        else await fs.promises.copyFile(source, path.join(info, options.onlyThumbnail ? 'video_thumbnail.png' : path.basename(source)));
        if (options.changeSource) await fs.promises.appendFile(source, 'changed');
        return { url: `http://localhost:6060/images/${id}.info`, fileName: path.basename(source), isImage: false, port: 6060, profileId: 'test' };
    };
    return { plugin, calls, trashed, contents, note, add, caches, emit,
        clean: () => assert.equal([...listeners.values()].reduce((sum, refs) => sum + refs.size, 0), 0, 'Temporary listeners must be removed') };
}

try {
    const outfile = path.join(temp, 'batch.cjs');
    await build({
        entryPoints: [path.join(repo, 'src/markdownAttachmentBatchUpload.ts')], outfile,
        bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
        plugins: [{ name: 'batch-host', setup(builder) {
            builder.onResolve({ filter: /.*/ }, args => args.path in stubs ? { path: args.path, namespace: 'stub' } : undefined);
            builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path] }));
        } }],
    });
    const { uploadCurrentMarkdownAttachmentsToEagle: run } = createRequire(import.meta.url)(outfile);

    const success = await fixture();
    const originalRead = fs.promises.readFile;
    const originalStat = fs.promises.stat;
    try {
        fs.promises.readFile = (...args) => { assert.ok(!String(args[0]).endsWith('.mp4'), 'Video bytes must not enter JS memory'); return originalRead(...args); };
        fs.promises.stat = async (...args) => {
            const stats = await originalStat(...args);
            if (String(args[0]).endsWith('.mp4')) stats.size = 8 * 1024 ** 3;
            return stats;
        };
        await run(success.plugin);
        assert.equal(success.calls.length, 1, 'Repeated video references upload once');
        assert.deepEqual(success.trashed, ['clip.mp4']);
        assert.equal(success.contents.get('note.md'), '---\ntitle: video data\nlikes: 123\n---\n![clip.mp4](http://localhost:6060/images/ITEM_1.info)\n[观看视频](http://localhost:6060/images/ITEM_1.info)');
        success.clean();
    } finally { fs.promises.readFile = originalRead; fs.promises.stat = originalStat; }

    const partial = await fixture({ text: '![[clip.mp4]]\n![[bad.mp4]]', failFile: 'bad.mp4' });
    await run(partial.plugin);
    assert.match(partial.contents.get('note.md'), /ITEM_1\.info\)\n!\[\[bad\.mp4\]\]/);
    assert.deepEqual(partial.trashed, ['clip.mp4']);
    partial.clean();

    const delayedMetadata = await fixture();
    const originalAccess = fs.promises.access;
    let metadataReads = 0;
    try {
        fs.promises.access = async (...args) => {
            if (String(args[0]).endsWith('metadata.json') && metadataReads++ < 2) throw new Error('Metadata not flushed yet');
            return originalAccess(...args);
        };
        await run(delayedMetadata.plugin);
        assert.ok(metadataReads >= 3);
        assert.deepEqual(delayedMetadata.trashed, ['clip.mp4'], 'Wait for the identified copy before removing the source');
        delayedMetadata.clean();
    } finally { fs.promises.access = originalAccess; }

    for (const option of [{ incompleteCopy: true }, { onlyThumbnail: true }, { changeSource: true }, { properties: { video: 'clip.mp4' } }]) {
        const retained = await fixture(option);
        await run(retained.plugin);
        assert.equal(retained.trashed.length, 0);
        assert.match(retained.contents.get('note.md'), /ITEM_1\.info/);
        retained.clean();
    }

    const shared = await fixture();
    const other = await shared.add('other.md', '---\nvideo: clip.mp4\n---');
    shared.caches.set(other.path, { frontmatter: { video: 'clip.mp4' } });
    await shared.add('shared.canvas', JSON.stringify({ nodes: [{ type: 'file', file: 'clip.mp4' }] }));
    await run(shared.plugin);
    assert.equal(shared.trashed.length, 0);
    shared.clean();

    const changed = await fixture({ duringUpload: async ({ add, emit }) => { const other = await add('new-reference.md', '![[clip.mp4]]'); emit('create', other); } });
    await run(changed.plugin);
    assert.equal(changed.trashed.length, 0, 'New references during a slow upload must retain the source');
    changed.clean();

    const edited = await fixture({ duringUpload: ({ contents }) => { contents.set('note.md', 'User edited this during upload'); } });
    await run(edited.plugin);
    assert.equal(edited.contents.get('note.md'), 'User edited this during upload');
    assert.equal(edited.trashed.length, 0);
    edited.clean();

    const unreadable = await fixture();
    await unreadable.add('broken.canvas', '{bad JSON');
    await run(unreadable.plugin);
    assert.equal(unreadable.trashed.length, 0);
    unreadable.clean();

    let release;
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    const pause = new Promise(resolve => { release = resolve; });
    const concurrent = await fixture({ duringUpload: () => { entered(); return pause; } });
    const first = run(concurrent.plugin);
    await started;
    await run(concurrent.plugin);
    assert.equal(concurrent.calls.length, 1);
    assert.ok(notices.some(message => message.includes('附件上传仍在进行')));
    release();
    await first;
    concurrent.clean();

    console.log('Batch tests passed: video migration, 8 GiB file metadata without buffering, shared references/YAML, partial failures, copy verification, changed files, concurrent runs, listener cleanup.');
} finally {
    delete globalThis.batchTestHost;
    delete globalThis.batchResolve;
    assert.equal(path.dirname(temp), os.tmpdir());
    assert.ok(path.basename(temp).startsWith('eaglebridge-batch-test-'));
    await fs.promises.rm(temp, { recursive: true, force: true });
}
