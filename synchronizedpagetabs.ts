import { App, Notice, TFile } from 'obsidian';
import { MyPluginSettings } from './setting';
import { print, setDebug } from './main';

export async function syncTags(app: App, settings: MyPluginSettings) {
	try {
		// 获取当前 Markdown 文件的 YAML 标签
		const yamlTags = getYamlTagsFromCurrentFile(app); // 例如：['tag1', 'tag2']

		// 检查 advancedID 设置
		let additionalTags: string[] = [];
		if (settings.advancedID) {
			const yamlId = getYamlIdFromCurrentFile(app);
			if (yamlId) {
				additionalTags.push(yamlId);
			}
		}

		// 获取当前文件中所有的 .info 文件 ID
		const infoFileIds = await getInfoFileIdsFromCurrentFile(app); // 例如：['M5U5BORKN1LNW', 'KBHG6KA0Y5S9W']

		for (const id of infoFileIds) {
			// 获取当前 .info 文件的标签
			const currentTags = await fetchTagsForInfoFile(id);

			// 合并并去重标签
			const newTags = Array.from(new Set([...currentTags, ...yamlTags, ...additionalTags]));

			// 发送更新后的标签
			await updateTagsForInfoFile(id, newTags);
			new Notice('同步标签成功');
		}
	} catch (error) {
		print('Error syncing tags:', error);
		new Notice('Error syncing tags. Check console for details.');
	}
}

async function fetchTagsForInfoFile(id: string): Promise<string[]> {
	const requestOptions: RequestInit = {
		method: 'GET',
		redirect: 'follow' as RequestRedirect
	};

	const response = await fetch(`http://localhost:41595/api/item/info?token=YOUR_API_TOKEN&id=${id}`, requestOptions);
	const result = await response.json();
	return result.data.tags || [];
}

async function updateTagsForInfoFile(id: string, tags: string[]) {
	const data = {
		id: id,
		tags: tags
	};

	const requestOptions: RequestInit = {
		method: 'POST',
		body: JSON.stringify(data),
		redirect: 'follow' as RequestRedirect
	};

	const response = await fetch("http://localhost:41595/api/item/update", requestOptions);
	const result = await response.json();
	print(`Updated tags for ${id}:`, result);
}

function getYamlTagsFromCurrentFile(app: App): string[] {
	const activeFile = app.workspace.getActiveFile();
	if (!activeFile) {
		new Notice('No active file found.');
		return [];
	}

	const fileCache = app.metadataCache.getFileCache(activeFile);
	if (!fileCache || !fileCache.frontmatter) {
		new Notice('No YAML frontmatter found.');
		return [];
	}

	return fileCache.frontmatter.tags || [];
}

async function getInfoFileIdsFromCurrentFile(app: App): Promise<string[]> {
	const activeFile = app.workspace.getActiveFile();
	if (!activeFile) {
		new Notice('No active file found.');
		return [];
	}

	const fileContent = await app.vault.read(activeFile);
	const regex = /http:\/\/localhost:\d+\/images\/([A-Z0-9]+)\.info/g;
	let match;
	const ids = new Set<string>();

	while ((match = regex.exec(fileContent)) !== null) {
		ids.add(match[1]); // match[1] 是正则表达式中捕获的 ID
	}

	return Array.from(ids);
}

function getYamlIdFromCurrentFile(app: App): string | null {
	const activeFile = app.workspace.getActiveFile();
	if (!activeFile) {
		new Notice('No active file found.');
		return null;
	}

	const fileCache = app.metadataCache.getFileCache(activeFile);
	if (!fileCache || !fileCache.frontmatter) {
		new Notice('No YAML frontmatter found.');
		return null;
	}

	return fileCache.frontmatter.id || null;
}
