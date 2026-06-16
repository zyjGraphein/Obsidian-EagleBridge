import { Menu, MenuItem, MarkdownView, Notice, Modal, App, Setting, TFile } from 'obsidian';
import MyPlugin from './main';
import * as path from 'path';
import { onElement } from './onElement';
import { print } from './main';
import { exec, execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { EditorView} from '@codemirror/view';
import { extractEagleItemIdFromUrl } from './eagleReferenceView';
import { openDeleteEagleAttachmentModal } from './eagleDeletion';
import { readEagleItemInfoById, resolveEagleItemById } from './eagleItemResolver';
import { extractEagleLinkTarget, findLibraryProfileByPort } from './libraryProfiles';
import { switchEagleLibrary, updateItemInLibrary } from './eagleApi';

const electron = require('electron');
const shell = electron.shell as {
    openExternal: (target: string) => Promise<void>;
    openPath: (target: string) => Promise<string>;
    showItemInFolder: (fullPath: string) => void;
};

function getRevealMenuTitle(): string {
    if (process.platform === 'darwin') {
        return 'Reveal in Finder';
    }

    if (process.platform === 'win32') {
        return 'Show in File Explorer';
    }

    return 'Reveal in file manager';
}

function getOtherAppsMenuTitle(): string {
    return process.platform === 'win32' ? 'Open in other apps' : getRevealMenuTitle();
}

async function openFileInDefaultApp(filePath: string): Promise<void> {
    const errorMessage = await shell.openPath(filePath);
    if (errorMessage) {
        throw new Error(errorMessage);
    }
}

function revealFileInSystemBrowser(filePath: string): void {
    shell.showItemInFolder(filePath);
}

function openFileInOtherApps(filePath: string): Promise<void> {
    if (process.platform !== 'win32') {
        revealFileInSystemBrowser(filePath);
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        const child = spawn('rundll32', ['shell32.dll,OpenAs_RunDLL', filePath], { shell: true });

        child.on('error', reject);
        child.on('exit', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`EXIT_CODE_${String(code)}`));
            }
        });
    });
}

function isEagleInfoUrl(url: string): boolean {
    return /^http:\/\/localhost:\d+\/images\/[^/\s?#]+\.info$/i.test(url);
}

export interface EagleBridgeMenuContext {
	url: string;
	mode: 'source' | 'preview';
	targetPos?: number | null;
	host?: string;
}

export type EagleBridgeTransferKind = 'paste' | 'drop';

export interface EagleBridgeIntegrationApiV1 {
	version: 1;
	canHandleUrl(url: string): boolean;
	appendContextMenuItems(menu: Menu, context: EagleBridgeMenuContext): Promise<boolean>;
	canResolveMarkdownTransfer?: (data: DataTransfer, kind: EagleBridgeTransferKind) => boolean;
	resolveMarkdownTransfer?: (data: DataTransfer, kind: EagleBridgeTransferKind) => Promise<string[] | null>;
}

function resolveProfileForUrl(plugin: MyPlugin, url: string) {
	const target = extractEagleLinkTarget(url);
	if (!target) {
		return null;
	}

	const profile = findLibraryProfileByPort(plugin.settings, target.port);
	if (!profile?.resolvedPath) {
		return null;
	}

	return {
		target,
		profile,
	};
}

async function resolveLocalFilePath(plugin: MyPlugin, itemId: string, itemUrl?: string): Promise<string | null> {
    const linkTarget = itemUrl ? extractEagleLinkTarget(itemUrl) : null;
    const profile = linkTarget ? findLibraryProfileByPort(plugin.settings, linkTarget.port) : null;
    const libraryPath = profile?.resolvedPath || (!itemUrl ? plugin.settings.libraryPath.trim() : '');
    if (!libraryPath) {
        return null;
    }

    const resolvedItem = await resolveEagleItemById(libraryPath, itemId);
    if (!resolvedItem?.sourceFilePath) {
        return null;
    }

    print(`Resolved Eagle item ${itemId} to ${resolvedItem.sourceFilePath}`);
    return resolvedItem.sourceFilePath;
}

function getActiveReferenceFile(plugin: MyPlugin): TFile | null {
    const activeFile = plugin.app.workspace.getActiveFile();
    return activeFile instanceof TFile ? activeFile : null;
}

async function openDeleteAttachmentDialog(
    plugin: MyPlugin,
    url: string,
    options: {
        contextTitle: string;
        currentLinkMode?: 'precise-current-link' | 'current-file-links';
        currentLinkTargetPos?: number | null;
        currentLinkFile?: TFile | null;
        afterChange?: () => void | Promise<void>;
    },
) {
    const itemId = extractEagleItemIdFromUrl(url);
    if (!itemId) {
        new Notice('无法识别当前 Eagle 附件。');
        return;
    }

    const snapshot = await plugin.eagleReferenceIndex.ensureReady();
    let item = snapshot.itemsById.get(itemId);
    if (!item) {
        const rebuiltSnapshot = await plugin.eagleReferenceIndex.rebuild();
        item = rebuiltSnapshot.itemsById.get(itemId);
    }
    if (!item) {
        new Notice('未在引用索引中找到该 Eagle 附件。请先刷新引用索引后再试。');
        return;
    }

    openDeleteEagleAttachmentModal({
        plugin,
        item,
        itemUrl: url,
        contextTitle: options.contextTitle,
        currentLinkMode: options.currentLinkMode,
        currentLinkTargetPos: options.currentLinkTargetPos,
        currentLinkFile: options.currentLinkFile ?? getActiveReferenceFile(plugin),
        afterChange: async () => {
            plugin.eagleReferenceIndex.requestRefresh(50);
            await options.afterChange?.();
        },
    });
}

export function handleLinkClick(plugin: MyPlugin, event: MouseEvent, url: string) {
	const menu = new Menu();
	const inPreview = plugin.app.workspace.getActiveViewOfType(MarkdownView)?.getMode() == "preview";
	void showEagleImageContextMenu(plugin, menu, {
		url,
		mode: inPreview ? 'preview' : 'source',
		host: 'native',
	}, event);
}

export function eagleImageContextMenuCall(this: MyPlugin, event: MouseEvent) {
	const img = event.target as HTMLImageElement;
	const inTable: boolean = img.closest('table') != null;
	const inCallout: boolean = img.closest('.callout') != null;
	if (img.id == 'af-zoomed-image') return;
	if (!img.src.startsWith('http')) return;
    event.preventDefault();
	event.stopPropagation();
	this.app.workspace.getActiveViewOfType(MarkdownView)?.editor?.blur();
	img.classList.remove('image-ready-click-view', 'image-ready-resize');
	const url = img.src;
	const menu = new Menu();
	const inPreview = this.app.workspace.getActiveViewOfType(MarkdownView)?.getMode() == "preview";
	void showEagleImageContextMenu(this, menu, {
		url,
		mode: inPreview ? 'preview' : 'source',
		host: 'native',
	}, event, !inPreview && (inTable || inCallout) ? -138 : 0);
}

function resolveEagleUrlFromContextMenuEvent(plugin: MyPlugin, event: MouseEvent): { url: string; targetPos: number | null } | null {
    const target = event.target as HTMLElement | null;
    if (!target) {
        return null;
    }

    const iframeTarget = target.closest('iframe') as HTMLIFrameElement | null;
    if (iframeTarget?.src && isEagleInfoUrl(iframeTarget.src)) {
        return { url: iframeTarget.src, targetPos: null };
    }

    const anchorTarget = target.closest('a.external-link') as HTMLAnchorElement | null;
    if (anchorTarget?.href && isEagleInfoUrl(anchorTarget.href)) {
        return { url: anchorTarget.href, targetPos: null };
    }

    const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView || activeView.getMode() === 'preview') {
        return null;
    }

    const editor = activeView.editor;
    const editorView = (editor as any).cm as EditorView | undefined;
    if (!editorView) {
        return null;
    }

    const targetPos = editorView.posAtCoords({ x: event.clientX, y: event.clientY });
    if (typeof targetPos !== 'number') {
        return null;
    }

    const targetLine = editorView.state.doc.lineAt(targetPos);
    const lineText = targetLine.text;
    const relativePos = targetPos - targetLine.from;
    const urlMatches = Array.from(lineText.matchAll(/\bhttps?:\/\/[^\s)]+/g));
    const matchedUrl = urlMatches.find((match) => {
        const start = match.index ?? 0;
        const end = start + match[0].length;
        return relativePos >= start && relativePos <= end;
    })?.[0] ?? urlMatches.find((match) => isEagleInfoUrl(match[0]))?.[0];

    if (!matchedUrl || !isEagleInfoUrl(matchedUrl)) {
        return null;
    }

    return { url: matchedUrl, targetPos };
}

export function eagleLinkContextMenuCall(this: MyPlugin, event: MouseEvent) {
    const resolved = resolveEagleUrlFromContextMenuEvent(this, event);
    if (!resolved) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    const menu = new Menu();
    const inPreview = this.app.workspace.getActiveViewOfType(MarkdownView)?.getMode() === "preview";
    void showEagleImageContextMenu(this, menu, {
        url: resolved.url,
        mode: inPreview ? 'preview' : 'source',
        targetPos: resolved.targetPos,
        host: 'native',
    }, event);
}

export function registerEscapeButton(plugin: MyPlugin, menu: Menu, document: Document = activeDocument) {
	menu.register(
		onElement(
			document,
			"keydown" as keyof HTMLElementEventMap,
			"*",
			(e: KeyboardEvent) => {
				if (e.key === "Escape") {
					e.preventDefault();
					e.stopPropagation();
					menu.hide();
				}
			}
		)
	);
}

export function createEagleBridgeIntegrationApi(plugin: MyPlugin): EagleBridgeIntegrationApiV1 {
	return {
		version: 1,
		canHandleUrl: (url: string) => isEagleInfoUrl(url),
		appendContextMenuItems: async (menu: Menu, context: EagleBridgeMenuContext) => {
			if (!isEagleInfoUrl(context.url)) return false;
			if (context.mode === 'preview') {
				await appendEagleImageMenuPreviewItems(plugin, menu, context.url);
				return true;
			}
			await appendEagleImageMenuSourceItems(plugin, menu, context.url, context);
			return true;
		},
	};
}

async function showEagleImageContextMenu(
	plugin: MyPlugin,
	menu: Menu,
	context: EagleBridgeMenuContext,
	event: MouseEvent,
	offset = 0,
) {
	await plugin.integrationApi.appendContextMenuItems(menu, context);
	registerEscapeButton(plugin, menu);
	menu.showAtPosition({ x: event.pageX, y: event.pageY + offset });
}

async function appendEagleImageMenuPreviewItems(plugin: MyPlugin, menu: Menu, oburl: string) {
	const imageInfo = await fetchImageInfo(plugin, oburl);

    if (imageInfo) {
        const { id, name, ext, annotation, tags, url } = imageInfo;
        // const infoToCopy = `ID: ${id}, Name: ${name}, Ext: ${ext}, Annotation: ${annotation}, Tags: ${tags}, URL: ${url}`;
        // navigator.clipboard.writeText(infoToCopy);
        // new Notice(`Copied: ${infoToCopy}`);
        menu.addItem((item: MenuItem) =>
            item
                .setIcon("file-symlink")
                .setTitle("Open in obsidian")
                .onClick(async (event: MouseEvent) => {
                    // 根据设置决定如何打开链接
                    const openMethod = plugin.settings.openInObsidian || 'newPage';
                    
                    if (openMethod === 'newPage') {
                        // 在新页面打开（默认行为）
                        window.open(oburl, '_blank');
                    } else if (openMethod === 'popup') {
                        // 使用 Obsidian 的独立窗口打开
                        const leaf = plugin.app.workspace.getLeaf('window');
                        await leaf.setViewState({
                            type: 'webviewer',
                            state: {
                                url: oburl,
                                navigate: true,
                            },
                            active: true,
                        });
                    } else if (openMethod === 'rightPane') {
                        // 在右侧新栏中打开
                        const leaf = plugin.app.workspace.getLeaf('split', 'vertical');
                        await leaf.setViewState({
                            type: 'webviewer',
                            state: {
                                url: oburl,
                                navigate: true,
                            },
                            active: true,
                        });
                    }
                })
        );
        
        
        
        menu.addItem((item: MenuItem) =>
            item
                .setIcon("file-symlink")
                .setTitle("Open in eagle")
                .onClick(async () => {
                    const targetProfile = resolveProfileForUrl(plugin, oburl);
                    if (targetProfile) {
                        await switchEagleLibrary(targetProfile.profile.resolvedPath);
                    }
                    const eagleLink = `eagle://item/${id}`;
                    navigator.clipboard.writeText(eagleLink);
                    await shell.openExternal(eagleLink);
                })
        );

        menu.addItem((item: MenuItem) =>
            item
                .setIcon("network")
                .setTitle("Show Eagle references")
                .onClick(async () => {
                    const itemId = extractEagleItemIdFromUrl(oburl);
                    await plugin.openEagleReferenceView(itemId);
                })
        );

        menu.addItem((item: MenuItem) =>
            item
                .setIcon("square-arrow-out-up-right")
                .setTitle("Open in the default app")
                .onClick(async () => {
                    const localFilePath = await resolveLocalFilePath(plugin, id, oburl);
                    if (!localFilePath) {
                        new Notice('Cannot find the local source file, please check Eagle library path');
                        return;
                    }

                    try {
                        await openFileInDefaultApp(localFilePath);
                    } catch (error) {
                        print('Error opening file:', error);
                        new Notice('Cannot open the local source file');
                    }
                })
        );
        menu.addItem((item: MenuItem) =>
            item
                .setIcon("external-link")
                .setTitle(getOtherAppsMenuTitle())
                .onClick(async () => {
                    const localFilePath = await resolveLocalFilePath(plugin, id, oburl);
                    if (!localFilePath) {
                        new Notice('Cannot find the local source file, please check Eagle library path');
                        return;
                    }

                    try {
                        await openFileInOtherApps(localFilePath);
                    } catch (error) {
                        print('Error opening file:', error);
                        new Notice('Cannot open the local source file');
                    }
                })
        );	
        // 复制源文件
        menu.addItem((item: MenuItem) =>
        item
            .setIcon("copy")
            .setTitle("Copy source file")
            .onClick(async () => {
                const localFilePath = await resolveLocalFilePath(plugin, id, oburl);
                if (!localFilePath) {
                    new Notice("Cannot find the local source file", 3000);
                    return;
                }
                try {
                    copyFileToClipboardCMD(localFilePath);
                    new Notice("Copied to clipboard!", 3000);
                } catch (error) {
                    console.error(error);
                    new Notice("Failed to copy the file!", 3000);
                }
            })
        );		
        menu.addItem((item: MenuItem) =>
            item
                .setIcon("case-sensitive")
                .setTitle(`Eagle Name: ${name}`)
                .onClick(() => {
                    navigator.clipboard.writeText(name);
                    new Notice(`Copied: ${name}`);
                })
        );

        menu.addItem((item: MenuItem) =>
            item
                .setIcon("letter-text")
                .setTitle(`Eagle Annotation: ${annotation}`)
                .onClick(() => {
                    navigator.clipboard.writeText(annotation);
                    new Notice(`Copied: ${annotation}`);
                })
        );

        menu.addItem((item: MenuItem) =>
            item
                .setIcon("link-2")
                .setTitle(`Eagle url: ${url}`)
                .onClick(() => {
                    // navigator.clipboard.writeText(url);
                    window.open(url, '_self'); 
                    new Notice(`Copied: ${url}`);
                })
        );
        // 确保 tags 是一个数组
        const tagsArray = Array.isArray(tags) ? tags : tags.split(',').map(tag => tag.trim());

        menu.addItem((item: MenuItem) =>
            item
                .setIcon("tags")
                .setTitle(`Eagle tag: ${tagsArray.join(', ')}`)
                .onClick(() => {
                    const tagsString = tagsArray.join(', ');
                    navigator.clipboard.writeText(tagsString)
                        .then(() => new Notice(`Copied: ${tagsString}`))
                        .catch(err => new Notice('Failed to copy tags'));
                })
        );
        menu.addItem((item: MenuItem) =>
            item
                .setIcon("wrench")
                .setTitle("Modify properties")
                .onClick(() => {
                    new ModifyPropertiesModal(plugin, oburl, id, name, annotation, url, tagsArray, (newId, newName, newAnnotation, newUrl, newTags) => {
                        // new Notice(`Name changed to: ${newName}`);
                        // 在这里处理保存逻辑
                    }).open();
                })
        );
        // 其他菜单项可以继续使用 { id, name, ext } 数据
    }

    menu.addItem((item: MenuItem) =>
        item
            .setIcon("trash-2")
            .setTitle("Delete attachment")
            .onClick(async () => {
                await openDeleteAttachmentDialog(plugin, oburl, {
                    contextTitle: '将删除 Eagle 附件，并可选择是否删除当前文件中的链接',
                    currentLinkMode: 'current-file-links',
                    currentLinkFile: getActiveReferenceFile(plugin),
                });
            })
    );
}

async function appendEagleImageMenuSourceItems(
	plugin: MyPlugin,
	menu: Menu,
	url: string,
	context: EagleBridgeMenuContext,
) {
	await appendEagleImageMenuPreviewItems(plugin, menu, url);

    menu.addItem((item: MenuItem) =>
        item
            .setIcon("copy")
            .setTitle("Copy markdown link")
            .onClick(async () => {
                const editor = plugin.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
                if (!editor) {
                    new Notice('Cannot find the active editor');
                    return;
                }

                const doc = editor.getDoc();
                const lineCount = doc.lineCount();

                let linkFound = false;

                for (let line = 0; line < lineCount; line++) {
                    const lineText = doc.getLine(line);

                    // 使用正则表达式查找 Markdown 链接，匹配带叹号和不带叹号的链接
                    const regex = new RegExp(`(!?\\[.*?\\]\\(${url}\\))`, 'g');
                    const match = regex.exec(lineText);

                    if (match) {
                        const linkText = match[1]; // 获取完整的匹配文本
                        navigator.clipboard.writeText(linkText);
                        new Notice('Link copied');
                        linkFound = true;
                        break; // 找到并复制后退出循环
                    }
                }

                if (!linkFound) {
                    new Notice('Cannot find the link');
                }
                
            })
    );
    menu.addItem((item: MenuItem) =>
        item
            .setIcon("trash-2")
            .setTitle("Clear markdown link")
            .onClick(() => {
                try {
                    const targetPos = resolveTargetPosForContext(plugin, context);
                    if (typeof targetPos !== 'number') {
                        throw new Error('NO_TARGET_POS');
                    }
                    deleteCurTargetLink(url, plugin, targetPos);
                } catch {
                    new Notice("Error, could not clear the file!");
                }
            })
    );
    menu.addItem((item: MenuItem) =>
        item
            .setIcon("trash")
            .setTitle("Delete attachment")
            .onClick(async () => {
                await openDeleteAttachmentDialog(plugin, url, {
                    contextTitle: '将删除 Eagle 附件，并可选择是否删除当前链接或全部链接',
                    currentLinkMode: 'precise-current-link',
                    currentLinkTargetPos: typeof context.targetPos === 'number' ? context.targetPos : null,
                    currentLinkFile: getActiveReferenceFile(plugin),
                });
            })
    );
} 

export async function addEagleImageMenuPreviewMode(plugin: MyPlugin, menu: Menu, oburl: string, event: MouseEvent) {
	await showEagleImageContextMenu(plugin, menu, {
		url: oburl,
		mode: 'preview',
		host: 'native',
	}, event);
}

export async function addEagleImageMenuSourceMode(plugin: MyPlugin, menu: Menu, url: string, event: MouseEvent, targetPos?: number | null) {
	await showEagleImageContextMenu(plugin, menu, {
		url,
		mode: 'source',
		targetPos,
		host: 'native',
	}, event);
}

// 修改eagle属性中的annotation,url,tags
class ModifyPropertiesModal extends Modal {
	plugin: MyPlugin;
	itemUrl: string;
	id: string;
	name: string;
	annotation: string;
	url: string;
	tags: string[];
	onSubmit: (id: string, name: string, annotation: string, url: string, tags: string[]) => void;

	constructor(plugin: MyPlugin, itemUrl: string, id: string, name: string, annotation: string, url: string, tags: string[], onSubmit: (id: string, name: string, annotation: string, url: string, tags: string[]) => void) {
		super(plugin.app);
		this.plugin = plugin;
		this.itemUrl = itemUrl;
		this.id = id;
		this.name = name;
		this.annotation = annotation;
		this.url = url;
		this.tags = tags;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Modify Properties' });

		new Setting(contentEl)
			.setName('Annotation')
			.addText(text => text
				.setValue(this.annotation)
				.onChange(value => {
					this.annotation = value;
				})
				.inputEl.style.width = '400px'
			);

		new Setting(contentEl)
			.setName('URL')
			.addText(text => text
				.setValue(this.url)
				.onChange(value => {
					this.url = value;
				})
				.inputEl.style.width = '400px'
			);

		new Setting(contentEl)
			.setName('Tags')
			.setDesc('Separate tags use ,')
			.addText(text => text
				.setValue(this.tags.join(', '))
				.onChange(value => {
					this.tags = value.split(',').map(tag => tag.trim());
				})
				.inputEl.style.width = '400px'
			);

		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('Save')
				.setCta()
				.onClick(async () => {
					const targetProfile = resolveProfileForUrl(this.plugin, this.itemUrl);
					if (!targetProfile) {
						new Notice('Failed to resolve Eagle library for this item');
						return;
					}

					const updated = await updateItemInLibrary(targetProfile.profile, this.id, {
						tags: this.tags,
						annotation: this.annotation,
						url: this.url,
					});
					if (!updated) {
						new Notice('Failed to upload data');
						return;
					}

					new Notice('Data uploaded successfully');
					this.onSubmit(this.id, this.name, this.annotation, this.url, this.tags);
					this.close();
				}));
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}


function copyFileToClipboardCMD(filePath: string) {

	if (!existsSync(filePath)) {
        console.error(`File ${filePath} does not exist`);
        return;
    }

    const callback = (error: Error | null, stdout: string, stderr: string) => {
        if (error) {
			new Notice(`Error executing command: ${error.message}`, 3000);
			console.error(`Error executing command: ${error.message}`);
			return;
        }
    };

    if (process.platform === 'darwin') {
		execSync(`open -R "${filePath}"`);
        execSync(`osascript -e 'tell application "System Events" to keystroke "c" using command down'`);
        execSync(`osascript -e 'tell application "System Events" to keystroke "w" using command down'`);
		execSync(`open -a "Obsidian.app"`);
    } else if (process.platform === 'linux') {
    } else if (process.platform === 'win32') {
		let safeFilePath = filePath.replace(/'/g, "''");
        exec(`powershell -command "Set-Clipboard -Path '${safeFilePath}'"`, callback);
    }
}

export async function fetchImageInfo(plugin: MyPlugin, url: string): Promise<{ id: string, name: string, ext: string, annotation: string, tags: string, url: string } | null> {
	const targetProfile = resolveProfileForUrl(plugin, url);
	if (!targetProfile) {
		print('Invalid image source format');
		return null;
	}

	try {
		const itemInfo = await readEagleItemInfoById(targetProfile.profile.resolvedPath, targetProfile.target.itemId);
		if (!itemInfo) {
			print('Failed to read local item info');
			return null;
		}

		return {
			...itemInfo,
			tags: itemInfo.tags.join(', '),
		};
	} catch (error) {
		print('Error fetching item info', error);
		return null;
	}
}

function resolveTargetPosForContext(plugin: MyPlugin, context: EagleBridgeMenuContext): number | null {
	if (typeof context.targetPos === 'number') {
		return context.targetPos;
	}

	const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
	if (!activeView || activeView.getMode() === 'preview') {
		return null;
	}

	const editorView = (activeView.editor as typeof activeView.editor & { cm?: EditorView }).cm;
	if (!editorView) {
		return null;
	}

	const doc = editorView.state.doc;
	for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber++) {
		const line = doc.line(lineNumber);
		const match = new RegExp(`!?\\[[^\\]]*\\]\\(${escapeRegExp(context.url)}[^)]*\\)`, 'g').exec(line.text);
		if (!match || typeof match.index !== 'number') continue;
		return line.from + match.index;
	}

	return null;
}

export function deleteCurTargetLink(
    url: string,
    plugin: MyPlugin,
    target_pos: number,
) {
    const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
        new Notice("无法获取活动视图！", 3000);
        return;
    }
    const editor = activeView.editor;
    const editorView = (editor as any).cm as EditorView;
    
    // 获取目标行和文本
    const target_line = editorView.state.doc.lineAt(target_pos);
    const line_text = target_line.text;
    
    // 检查是否在表格或callout中
    const target = editorView.domAtPos(target_pos).node as HTMLElement;
    const inTable = !!target.closest('table');
    const inCallout = !!target.closest('.callout');
    
    if (!inTable && !inCallout) {
        // 普通文本中的链接
        const finds = findLinkInLine(url, line_text);
        if (finds.length === 0) {
            new Notice("无法找到链接文本，请手动删除！", 3000);
            return;
        }
        else if (finds.length !== 1) {
            new Notice("当前行中发现多个相同的链接，请手动删除！", 3000);
            return;
        }
        else {
            editor.replaceRange('', 
                {line: target_line.number-1, ch: finds[0][0]}, 
                {line: target_line.number-1, ch: finds[0][1]}
            );
            return;
        }
    }
    
    // 处理表格或callout中的链接
    const startReg: {[key: string]: RegExp} = {
        'table': /^\s*\|/,
        'callout': /^>/,
    };
    
    const mode = inTable ? 'table' : 'callout';
    let finds_lines: number[] = [];
    let finds_all: [number, number][] = [];
    
    // 向下搜索
    for (let i = target_line.number; i <= editor.lineCount(); i++) {
        const line_text = editor.getLine(i-1);
        if (!startReg[mode].test(line_text)) break;
        
        const finds = findLinkInLine(url, line_text);
        if (finds.length > 0) {
            finds_lines.push(...new Array(finds.length).fill(i));
            finds_all.push(...finds);
        }
    }
    
    // 向上搜索
    for (let i = target_line.number-1; i >= 1; i--) {
        const line_text = editor.getLine(i-1);
        if (!startReg[mode].test(line_text)) break;
        
        const finds = findLinkInLine(url, line_text);
        if (finds.length > 0) {
            finds_lines.push(...new Array(finds.length).fill(i));
            finds_all.push(...finds);
        }
    }
    
    if (finds_all.length === 0) {
        new Notice(`无法在${mode}中找到链接文本，请手动删除！`, 3000);
        return;
    }
    else if (finds_all.length !== 1) {
        new Notice(`在${mode}中找到多个相同的链接，请手动删除！`, 3000);
        return;
    }
    else {
        editor.replaceRange('', 
            {line: finds_lines[0]-1, ch: finds_all[0][0]}, 
            {line: finds_lines[0]-1, ch: finds_all[0][1]}
        );
    }
    
    editor.focus();
}

// 查找一行中包含特定URL的链接
function findLinkInLine(url: string, line: string): [number, number][] {
    const results: [number, number][] = [];
    
    // 匹配Markdown链接: ![alt](url) 或 [text](url)
    const regex = new RegExp(`(!?\\[[^\\]]*\\]\\(${escapeRegExp(url)}[^)]*\\))`, 'g');
    
    let match;
    while ((match = regex.exec(line)) !== null) {
        results.push([match.index, match.index + match[0].length]);
    }
    
    return results;
}

// 转义正则表达式特殊字符
function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
