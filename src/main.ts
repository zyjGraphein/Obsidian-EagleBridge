import { Menu,MenuItem,App, Editor, MarkdownView, Modal, Notice, Plugin, Setting,TFile, Platform, FileStats } from 'obsidian';
import { startServer, refreshServer, stopServer } from './server';
import { handlePasteEvent, handleDropEvent, shouldTrackMarkdownDragCursor, syncEditorCursorToDragEvent } from './urlHandler';
import { onElement } from './onElement';
import { exec, spawn, execSync } from 'child_process';
import * as path from 'path';
import { addCommandSynchronizedPageTabs, addCommandSyncCurrentPageObsidianLink } from "./addCommand-config";
import { existsSync } from 'fs';
import { MyPluginSettings, DEFAULT_SETTINGS, SampleSettingTab, isAppendPageTagsMode, isImportEagleTagsMode, normalizeAttachmentTagSyncMode, normalizeUploadSettings, shouldReplacePageTagsInEagle } from './setting';
import { handleImageClick, removeZoomedImage } from './Leftclickimage';
import { handleLinkClick, eagleImageContextMenuCall, registerEscapeButton, addEagleImageMenuSourceMode, addEagleImageMenuPreviewMode, fetchImageInfo } from './menucall';
import { isAltTextImage, isURL, isLocalHostLink} from './embed';
import { embedManager } from './embed';
import { embedField } from './embed-state-field';
import { Extension } from "@codemirror/state";
import { registerCanvasAutoNormalize, registerCanvasDocument } from './canvasHandler';
import { FileTagSyncState, getFileTagSyncState, mergeItemTagsIntoFileFrontmatter, syncTagsToItemIds } from './synchronizedpagetabs';
import { syncObsidianLinkForFile } from './obsidianLinkSync';
import { registerMarkdownExportFileMenu } from './exportMarkdown';


let DEBUG = false;

export const print = (message?: any, ...optionalParams: any[]) => {
	// console.log('DEBUG status:', DEBUG); // 调试输出
	if (DEBUG) {
		console.log(message, ...optionalParams);
	}
}

export function setDebug(value: boolean) {
	DEBUG = value;
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	private autoTagSyncStates = new Map<string, FileTagSyncState>();
	private autoTagSyncTimers = new Map<string, ReturnType<typeof setTimeout>>();

	async onload() {
		console.log('加载 Eagle-Embed 插件');
		
		await this.loadSettings();
		
		// 注册编辑器扩展，务必正确导入和注册
		this.registerEditorExtension([embedField]);
		
		// 处理预览模式
		this.registerMarkdownPostProcessor((el, ctx) => {
			const images = el.querySelectorAll('img');
			images.forEach((image) => {
				if (embedManager.shouldEmbed(image.src)) {
					print(`MarkdownPostProcessor 找到可嵌入图像: ${image.src}`);
					this.handleImage(image);
				}
			});
		});
		
		// 注册外部文件支持
		// 注册图片右键菜单事件
		this.registerDocument(document);
		this.app.workspace.on("window-open", (workspaceWindow, window) => {
			this.registerDocument(window.document);
		});
		// 在插件加载时启动服务器
		startServer(this.settings.libraryPath, this.settings.port);
		registerCanvasAutoNormalize(this);
		// 添加设置面板
		this.addSettingTab(new SampleSettingTab(this.app, this));
		// await this.loadSettings();
		// 注册粘贴事件
		this.registerEvent(
			this.app.workspace.on('editor-paste', (clipboard: ClipboardEvent, editor: Editor) => {
				handlePasteEvent(clipboard, editor, this.settings.port, this);
			})
		);
		// 注册拖拽事件
		this.registerEvent(
			this.app.workspace.on('editor-drop', (event: DragEvent, editor: Editor) => {
				handleDropEvent(event, editor, this.settings.port, this);
			})
		);
		this.registerDomEvent(document, 'dragover', (event: DragEvent) => {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!activeView || activeView.getMode() === 'preview') {
				return;
			}

			const target = event.target as HTMLElement | null;
			if (!target?.closest('.cm-editor')) {
				return;
			}

			if (!shouldTrackMarkdownDragCursor(event, this)) {
				return;
			}

			syncEditorCursorToDragEvent(activeView.editor, event);
		}, { capture: true });
		// 在插件加载时设置 DEBUG 状态
		// console.log('Debug setting:', this.settings.debug);
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile) {
					this.scheduleAutoTagSync(file);
				}
			})
		);
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				this.scheduleAutoTagSync(file);
			})
		);
		this.registerEvent(
			this.app.vault.on('create', (file) => {
				if (file instanceof TFile && file.extension === 'md') {
					this.scheduleAutoTagSync(file);
				}
			})
		);
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file instanceof TFile) {
					this.clearAutoTagSyncTimer(file.path);
					this.autoTagSyncStates.delete(file.path);
				}
			})
		);
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile && file.extension === 'md') {
					const previousState = this.autoTagSyncStates.get(oldPath);
					this.clearAutoTagSyncTimer(oldPath);
					this.autoTagSyncStates.delete(oldPath);
					if (previousState) {
						this.autoTagSyncStates.set(file.path, previousState);
					}
					this.scheduleAutoTagSync(file);
				}
			})
		);
		setDebug(this.settings.debug);
		this.refreshAutoTagSyncState();

		this.registerDomEvent(document, "click", async (event: MouseEvent) => {
			const target = event.target as HTMLElement;
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!activeView) {
				print('Cannot find the active view');
				return;
			}

			const inPreview = activeView.getMode() === "preview";
			let url: string | null = null;

			if (inPreview) {
				if (!target.matches("a.external-link")) {
					return;
				}

				const linkElement = target as HTMLAnchorElement;
				if (linkElement && linkElement.href) {
					url = linkElement.href;
					print(`Preview mode link: ${url}`);
				}
			} else {
				if (!target.matches("span.external-link, .cm-link, a.cm-underline")) {
					return;
				}

				const editor = activeView.editor;
				const cursor = editor.getCursor();
				const lineText = editor.getLine(cursor.line);
				const urlMatches = Array.from(lineText.matchAll(/\bhttps?:\/\/[^\s)]+/g));
				print(urlMatches);
				let closestUrl = null;
				let minDistance = Infinity;
				const cursorPos = cursor.ch;
				print(cursorPos);

				for (let i = 0; i < urlMatches.length; i++) {
					const match = urlMatches[i];
					const end = (match.index || 0) + match[0].length + 1;
					if (cursorPos <= end) {
						closestUrl = match[0];
						print(`Cursor is in the link interval: ${i + 1}`);
						break;
					}
				}

				if (closestUrl) {
					url = closestUrl;
					print(`Edit mode link: ${url}`);
				}
			}

			if (url && url.match(/^http:\/\/localhost:\d+\/images\/[^.]+\.info$/)) {
				event.preventDefault();
				event.stopPropagation();
				print(`Prevented link: ${url}`);
				handleLinkClick(this, event, url);
			} else {
				return;
			}
		}, { capture: true });
		// 注册点击事件(参考AttachFlow)
		this.registerDomEvent(document, 'click', async (evt: MouseEvent) => {
			if (!this.settings.clickView) return;
			handleImageClick(evt, this.settings.adaptiveRatio);
		});

		this.registerDomEvent(document, 'keydown', (evt: KeyboardEvent) => {
			if (evt.key === 'Escape') {
				removeZoomedImage();
			}
		});
		// register all commands in addCommand function
		addCommandSynchronizedPageTabs(this);
		addCommandSyncCurrentPageObsidianLink(this);
		registerMarkdownExportFileMenu(this);
		// 添加自定义样式，确保样式包含编辑模式特定样式
		const style = document.createElement('style');
		style.textContent = `
			.menu-item {
				max-width: 800px; /* 设置最大宽度 */
				white-space: normal; /* 允许换行 */
				word-wrap: break-word; /* 自动换行 */
			}
			
			.eagle-embed-hide {
				display: none !important;
			}
			
			.eagle-embed-container {
				margin: 10px 0;
				border-radius: 5px;
				overflow: hidden;
				background: var(--background-primary);
				border: 1px solid var(--background-modifier-border);
				width: 100%;
			}
			
			.eagle-embed-container iframe {
				display: block;
				width: 100%;
				height: 500px;
				border: none;
			}
			
			/* 编辑模式样式 */
			.cm-embed-block {
				margin: 0.5em 0;
				width: 100%;
			}
			
			/* 占位符样式 */
			.eagle-embed-placeholder {
				background: var(--background-secondary);
				border-radius: 5px;
				padding: 1em;
				text-align: center;
				margin: 0.5em 0;
			}
			
			/* 错误样式 */
			.eagle-embed-error {
				background: rgba(255, 0, 0, 0.1);
				border: 1px solid rgba(255, 0, 0, 0.3);
				color: #ff0000;
				padding: 1em;
				text-align: center;
				margin: 0.5em 0;
				border-radius: 5px;
			}
		`;
		document.head.appendChild(style);

	}
	

	onunload() {
		// 在插件卸载时停止服务器
		stopServer();
		this.clearAllAutoTagSyncTimers();
		// this.app.vault.getResourcePath = this.originalGetResourcePath;
		// this.app.metadataCache.getFirstLinkpathDest = this.originalGetFirstLinkpathDest;
	}

	async loadSettings() {
		const loadedSettings = await this.loadData();
		this.settings = {
			...DEFAULT_SETTINGS,
			...loadedSettings,
			attachmentTagSyncMode: normalizeAttachmentTagSyncMode(loadedSettings),
			exactSyncPageTagsToEagle: loadedSettings?.exactSyncPageTagsToEagle === true,
			upload: normalizeUploadSettings(loadedSettings),
		};
		delete (this.settings as MyPluginSettings & { websiteUpload?: boolean }).websiteUpload;
		delete (this.settings as MyPluginSettings & { advancedID?: boolean }).advancedID;
		delete (this.settings as MyPluginSettings & { autoSyncPageTags?: boolean }).autoSyncPageTags;
		delete (this.settings as MyPluginSettings & { importEagleTagsToYaml?: boolean }).importEagleTagsToYaml;
		this.updateLibraryPath(); // 更新Library Path
	}

	async updateLibraryPath() {
		for (const path of this.settings.libraryPaths) {
			if (existsSync(path)) { // 检查路径是否存在
				this.settings.libraryPath = path;
				break;
			}
		}
		await this.saveSettings();
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	refreshAutoTagSyncState() {
		this.clearAllAutoTagSyncTimers();
		this.autoTagSyncStates.clear();

		if (!this.shouldTrackFileTagChanges()) {
			return;
		}

		void this.initializeAutoTagSyncStates();
	}

	private scheduleAutoTagSync(file: TFile) {
		if (!this.shouldTrackFileTagChanges() || file.extension !== 'md') {
			return;
		}

		this.clearAutoTagSyncTimer(file.path);
		const timer = setTimeout(() => {
			this.autoTagSyncTimers.delete(file.path);
			void this.runAutoTagSync(file);
		}, 600);
		this.autoTagSyncTimers.set(file.path, timer);
	}

	private async runAutoTagSync(file: TFile) {
		const previousState = this.autoTagSyncStates.get(file.path);
		const nextState = await getFileTagSyncState(this.app, file, this.settings);
		this.autoTagSyncStates.set(file.path, nextState);

		if (!previousState) {
			return;
		}

		try {
			const newItemIds = nextState.itemIds.filter((itemId) => !previousState.itemIds.includes(itemId));
			const pageToEagleStrategy = shouldReplacePageTagsInEagle(this.settings) ? 'replace' : 'append';

			if (newItemIds.length > 0) {
				if (isAppendPageTagsMode(this.settings) && nextState.pageTags.length > 0) {
					await syncTagsToItemIds(nextState.pageTags, newItemIds, { notify: false, strategy: pageToEagleStrategy });
				}

				if (isImportEagleTagsMode(this.settings)) {
					await mergeItemTagsIntoFileFrontmatter(this.app, file, newItemIds);
				}

				if (this.settings.autoSyncObsidianLinkToEagle) {
					await syncObsidianLinkForFile(this.app, file, this.settings, { notify: false, itemIds: newItemIds });
				}
			}

			if (previousState.tagSignature !== nextState.tagSignature) {
				if (isAppendPageTagsMode(this.settings) && nextState.itemIds.length > 0) {
					await syncTagsToItemIds(nextState.pageTags, nextState.itemIds, { notify: false, strategy: pageToEagleStrategy });
				}
				return;
			}
		} catch (error) {
			print(`Auto sync current page tags failed for ${file.path}:`, error);
		}
	}

	private async initializeAutoTagSyncStates() {
		for (const file of this.app.vault.getMarkdownFiles()) {
			this.autoTagSyncStates.set(file.path, await getFileTagSyncState(this.app, file, this.settings));
		}
	}

	private clearAutoTagSyncTimer(filePath: string) {
		const timer = this.autoTagSyncTimers.get(filePath);
		if (!timer) {
			return;
		}

		clearTimeout(timer);
		this.autoTagSyncTimers.delete(filePath);
	}

	private clearAllAutoTagSyncTimers() {
		for (const timer of this.autoTagSyncTimers.values()) {
			clearTimeout(timer);
		}
		this.autoTagSyncTimers.clear();
	}

	private shouldTrackFileTagChanges() {
		return isAppendPageTagsMode(this.settings)
			|| isImportEagleTagsMode(this.settings)
			|| this.settings.autoSyncObsidianLinkToEagle;
	}
	// 注册图片右键菜单事件
	registerDocument(document: Document) {
		this.register(
			onElement(
				document,
				"contextmenu",
				"img",
				eagleImageContextMenuCall.bind(this),
				{ capture: true }
			)
		);
		registerCanvasDocument(this, document);
	}
	handleImage(img: HTMLImageElement): HTMLElement | null {
		try {
			const alt = img.alt || "";
			const src = img.src;
			
			// print(`处理图像: ${src} 替代文本: ${alt}`);
			
			// 检查是否有 noembed 标记
			if (/noembed/i.test(alt)) {
				img.alt = alt.replace(/noembed/i, "").trim();
				// print("跳过嵌入: 图像标记为noembed");
				return null;
			}
			
			// 检查alt文本是否表示图片类型
			if (isAltTextImage(alt)) {
				// print(`根据alt文本识别为图片，跳过: ${alt}`);
				return null;
			}
			
			// 检查是否应该嵌入
			if (!isURL(src) || !embedManager.shouldEmbed(src, alt)) {
				// print("跳过嵌入: 不是有效URL或不应嵌入");
				return null;
			}
			
			// print(`创建嵌入内容: ${src}`);
			const embedResult = embedManager.create(src);
			const container = embedResult.containerEl;
			
			if (!img.parentElement) {
				// print("错误: 图像没有父元素");
				return null;
			}
			
			// 使用替换方法
			img.parentElement.replaceChild(container, img);
			
			
			return container;
		} catch (error) {
			console.error("处理图像时出错:", error);
			return null;
		}
	}
}

