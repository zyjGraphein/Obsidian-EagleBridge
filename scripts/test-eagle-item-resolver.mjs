import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

async function main() {
	const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'eaglebridge-resolver-test-'));
	const bundledResolverPath = path.join(tempRoot, 'eagleItemResolver.cjs');

	try {
		await esbuild.build({
			entryPoints: [path.join(repoRoot, 'src', 'eagleItemResolver.ts')],
			bundle: true,
			platform: 'node',
			format: 'cjs',
			logLevel: 'silent',
			outfile: bundledResolverPath,
		});

		const { resolveEagleItemById } = require(bundledResolverPath);
		const libraryPath = path.join(tempRoot, 'Library.library');
		await fs.promises.mkdir(path.join(libraryPath, 'images'), { recursive: true });

		await createEagleItem(libraryPath, 'EXACT1', { name: 'My File', ext: 'png' }, [
			{ name: 'My File.png', content: 'exact-match' },
		]);
		const exactItem = await resolveEagleItemById(libraryPath, 'EXACT1');
		assert.equal(exactItem?.sourceFileName, 'My File.png');

		await createEagleItem(libraryPath, 'CASE1', { name: 'image', ext: 'png' }, [
			{ name: 'Image.PNG', content: 'case-match' },
		]);
		const caseItem = await resolveEagleItemById(libraryPath, 'CASE1');
		assert.equal(caseItem?.sourceFileName, 'Image.PNG');

		await createEagleItem(libraryPath, 'UNICODE1', { name: 'Cafe\u0301', ext: 'png' }, [
			{ name: 'Caf\u00E9.png', content: 'unicode-match' },
		]);
		const unicodeItem = await resolveEagleItemById(libraryPath, 'UNICODE1');
		assert.equal(unicodeItem?.sourceFileName, 'Caf\u00E9.png');

		await createEagleItem(libraryPath, 'EXT1', { name: 'Wrong Name', ext: 'pdf' }, [
			{ name: 'Real Document.pdf', content: 'extension-fallback' },
		]);
		const extensionItem = await resolveEagleItemById(libraryPath, 'EXT1');
		assert.equal(extensionItem?.sourceFileName, 'Real Document.pdf');

		await createEagleItem(libraryPath, 'URL1', { name: 'Bookmark', ext: 'url' }, [
			{ name: 'Bookmark.url', content: '[InternetShortcut]\nURL=https://example.com/demo?ok=1\n' },
		]);
		const urlItem = await resolveEagleItemById(libraryPath, 'URL1');
		assert.equal(urlItem?.sourceFileName, 'Bookmark.url');
		assert.equal(urlItem?.externalUrl, 'https://example.com/demo?ok=1');

		console.log('Resolver tests passed: exact, case-insensitive, unicode normalization, extension fallback, url redirect');
	} finally {
		await fs.promises.rm(tempRoot, { recursive: true, force: true });
	}
}

async function createEagleItem(libraryPath, itemId, metadata, files) {
	const infoDirPath = path.join(libraryPath, 'images', `${itemId}.info`);
	await fs.promises.mkdir(infoDirPath, { recursive: true });
	await fs.promises.writeFile(
		path.join(infoDirPath, 'metadata.json'),
		`${JSON.stringify(metadata, null, 2)}\n`,
		'utf8',
	);

	for (const file of files) {
		await fs.promises.writeFile(path.join(infoDirPath, file.name), file.content, 'utf8');
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
