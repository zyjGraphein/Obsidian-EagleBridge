import { Menu,MenuItem,App, Editor, MarkdownView, MarkdownPostProcessorContext, MarkdownRenderChild, Modal, Notice, Plugin, Setting,TFile, Platform, FileStats } from 'obsidian';
import { refreshServers, stopServers } from './server';
import { EAGLEBRIDGE_ICON, registerEagleBridgeIcon } from './branding';
import { canResolveMarkdownTransfer, handlePasteEvent, handleDropEvent, resolveMarkdownTransfer, shouldTrackMarkdownDragCursor, syncEditorCursorToDragEvent } from './urlHandler';
import { onElement } from './onElement';
import { exec, spawn, execSync } from 'child_process';
import * as path from 'path';
import {
	addCommandSynchronizedPageTabs,
	addCommandSyncCurrentPageObsidianLink,
	addCommandUploadCurrentMarkdownAttachments,
} from "./addCommand-config";
import { MyPluginSettings, DEFAULT_SETTINGS, SampleSettingTab, isAppendPageTagsMode, isImportEagleTagsMode, normalizeAttachmentTagSyncMode, normalizeExternalUploadMode, normalizeUploadSettings, shouldReplacePageTagsInEagle } from './setting';
import { handleImageClick, removeZoomedImage } from './Leftclickimage';
import { handleLinkClick, eagleImageContextMenuCall, eagleLinkContextMenuCall, createEagleBridgeIntegrationApi, type EagleBridgeIntegrationApiV1 } from './menucall';
import { embedManager } from './embed';
import { embedField, editingEmbedField } from './embed-state-field';
import { Extension } from "@codemirror/state";
import { registerCanvasAutoNormalize, registerCanvasDocument } from './canvasHandler';
import { FileTagSyncState, getFileTagSyncState, mergeItemTagsIntoFileFrontmatter, syncTagsToTargets } from './synchronizedpagetabs';
import { syncObsidianLinkForFile } from './obsidianLinkSync';
import { registerMarkdownExportFileMenu } from './exportMarkdown';
import { EagleReferenceIndex, EagleReferenceView, EAGLE_REFERENCE_VIEW_TYPE, activateEagleReferenceView, type EagleReferenceViewMode } from './eagleReferenceView';
import { normalizeLibraryProfiles, syncLegacyLibrarySettings, getEnabledResolvedLibraryProfiles } from './libraryProfiles';


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
	eagleReferenceIndex: EagleReferenceIndex;
	integrationApi!: EagleBridgeIntegrationApiV1;
	private autoTagSyncStates = new Map<string, FileTagSyncState>();
	private autoTagSyncTimers = new Map<string, ReturnType<typeof setTimeout>>();

	async onload() {
		this.register(registerEagleBridgeIcon());
		console.log('加载 Eagle-Embed 插件');
		
		await this.loadSettings();
		this.integrationApi = {
			...createEagleBridgeIntegrationApi(this),
			canResolveMarkdownTransfer: (data, kind) => canResolveMarkdownTransfer(data, kind, this),
			resolveMarkdownTransfer: (data, kind) => resolveMarkdownTransfer(data, kind, this),
		};
		this.eagleReferenceIndex = new EagleReferenceIndex(this);
		this.register(() => {
			this.eagleReferenceIndex.destroy();
		});
		this.registerView(EAGLE_REFERENCE_VIEW_TYPE, (leaf) => new EagleReferenceView(leaf, this));
		this.register(() => {
			this.app.workspace.getLeavesOfType(EAGLE_REFERENCE_VIEW_TYPE).forEach((leaf) => leaf.detach());
		});
		this.addRibbonIcon(EAGLEBRIDGE_ICON, 'EagleBridge: Open reference view', () => {
			void this.openEagleReferenceView({ viewMode: 'current-file' });
		});
		this.addCommand({
			id: 'open-eagle-reference-view',
			name: 'Open Eagle reference view',
			callback: () => {
				void this.openEagleReferenceView({ viewMode: 'current-file' });
			},
		});
		this.addCommand({
			id: 'open-eagle-reference-current-file',
			name: 'Open Eagle references: current file',
			callback: () => {
				void this.openEagleReferenceView({ viewMode: 'current-file' });
			},
		});
		this.addCommand({
			id: 'open-eagle-reference-library-search',
			name: 'Open Eagle references: library search',
			callback: () => {
				void this.openEagleReferenceView({ viewMode: 'library-search' });
			},
		});
		this.addCommand({
			id: 'refresh-eagle-reference-index',
			name: 'Refresh Eagle reference index',
			callback: async () => {
				await this.eagleReferenceIndex.rebuild();
				new Notice('Eagle reference index refreshed.');
			},
		});
		
		// 注册编辑器扩展，务必正确导入和注册
		this.registerEditorExtension([editingEmbedField, embedField]);
		
		// 处理预览模式
		this.registerMarkdownPostProcessor((el, ctx) => {
			const images = el.querySelectorAll('img');
			images.forEach((image) => {
				if (!image.closest('.eagle-embed-container') && embedManager.shouldEmbed(image.src, image.alt)) {
					print(`MarkdownPostProcessor 找到可嵌入图像: ${image.src}`);
					this.handleImage(image, ctx);
				}
			});
		});
		
		// 注册外部文件支持
		// 注册图片右键菜单事件
		this.registerDocument(document);
		this.registerEvent(this.app.workspace.on("window-open", (workspaceWindow, window) => {
			this.registerDocument(window.document);
		}));
		// 在插件加载时启动所有有效库的本地预览服务
		await this.refreshLibraryProfilesAndServers(false);
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
					this.scheduleEagleReferenceRefresh(file);
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
				if (file instanceof TFile) {
					if (file.extension === 'md') {
						this.scheduleAutoTagSync(file);
					}
					this.scheduleEagleReferenceRefresh(file);
				}
			})
		);
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file instanceof TFile) {
					this.clearAutoTagSyncTimer(file.path);
					this.autoTagSyncStates.delete(file.path);
					this.scheduleEagleReferenceRefresh(file);
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
				if (file instanceof TFile) {
					this.scheduleEagleReferenceRefresh(file);
				}
				if (this.isTrackedEagleReferencePath(oldPath)) {
					this.eagleReferenceIndex.requestRefresh(50);
				}
			})
		);
		setDebug(this.settings.debug);
		this.refreshAutoTagSyncState();

		this.registerDomEvent(document, "click", async (event: MouseEvent) => {
			const target = event.target as HTMLElement;
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			// Source-mode clicks belong to the editor, including image names and sizes.
			if (!activeView || activeView.getMode() !== 'preview' || target.closest('.cm-editor')) {
				return;
			}
			const url = target.closest<HTMLAnchorElement>('a.external-link')?.href;

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
			handleImageClick(this.app, evt, this.settings.adaptiveRatio);
		}, { capture: true });

		this.registerDomEvent(document, 'keydown', (evt: KeyboardEvent) => {
			if (evt.key === 'Escape') {
				removeZoomedImage();
			}
		});
		// register all commands in addCommand function
		addCommandSynchronizedPageTabs(this);
		addCommandSyncCurrentPageObsidianLink(this);
		addCommandUploadCurrentMarkdownAttachments(this);
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

			.eagle-embed-container video,
			.eagle-embed-container audio {
				display: block;
				width: 100%;
				max-height: 70vh;
			}

			.eagle-embed-container img {
				display: block;
				max-width: 100%;
			}

			.eagle-embed-block {
				margin: 0;
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
		this.register(() => style.remove());

	}
	

	onunload() {
		// 在插件卸载时停止服务器
		void stopServers();
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
			libraryProfiles: normalizeLibraryProfiles(loadedSettings),
			externalUploadMode: normalizeExternalUploadMode(loadedSettings?.externalUploadMode),
			defaultUploadTargetId: typeof loadedSettings?.defaultUploadTargetId === 'string' ? loadedSettings.defaultUploadTargetId : '',
		};
		delete (this.settings as MyPluginSettings & { websiteUpload?: boolean }).websiteUpload;
		delete (this.settings as MyPluginSettings & { advancedID?: boolean }).advancedID;
		delete (this.settings as MyPluginSettings & { autoSyncPageTags?: boolean }).autoSyncPageTags;
		delete (this.settings as MyPluginSettings & { importEagleTagsToYaml?: boolean }).importEagleTagsToYaml;
		syncLegacyLibrarySettings(this.settings);
	}

	async refreshLibraryProfilesAndServers(saveSettings = true) {
		const resolvedProfiles = syncLegacyLibrarySettings(this.settings);
		await refreshServers(getEnabledResolvedLibraryProfiles(this.settings));
		if (saveSettings) {
			await this.saveSettings();
		}
		this.eagleReferenceIndex?.requestRefresh(50);
		return resolvedProfiles;
	}

	async saveSettings() {
		syncLegacyLibrarySettings(this.settings);
		await this.saveData(this.settings);
	}

	async openEagleReferenceView(
		options: { itemId?: string | null; viewMode?: EagleReferenceViewMode } = {},
	) {
		return activateEagleReferenceView(this, options);
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
			const newTargets = nextState.itemTargets.filter((target) =>
				!previousState.itemTargets.some((previousTarget) =>
					previousTarget.port === target.port && previousTarget.itemId === target.itemId,
				),
			);
			const pageToEagleStrategy = shouldReplacePageTagsInEagle(this.settings) ? 'replace' : 'append';

			if (newTargets.length > 0) {
				if (isAppendPageTagsMode(this.settings) && nextState.pageTags.length > 0) {
					await syncTagsToTargets(this.settings, nextState.pageTags, newTargets, { notify: false, strategy: pageToEagleStrategy });
				}

				if (isImportEagleTagsMode(this.settings)) {
					await mergeItemTagsIntoFileFrontmatter(this.app, file, this.settings, newTargets);
				}

				if (this.settings.autoSyncObsidianLinkToEagle) {
					await syncObsidianLinkForFile(this.app, file, this.settings, {
						notify: false,
						itemKeys: newTargets.map((target) => `${target.port}:${target.itemId}`),
					});
				}
			}

			if (previousState.tagSignature !== nextState.tagSignature) {
				if (isAppendPageTagsMode(this.settings) && nextState.itemTargets.length > 0) {
					await syncTagsToTargets(this.settings, nextState.pageTags, nextState.itemTargets, { notify: false, strategy: pageToEagleStrategy });
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
	private scheduleEagleReferenceRefresh(file: TFile) {
		if (!this.isTrackedEagleReferencePath(file)) {
			return;
		}

		this.eagleReferenceIndex.requestRefresh(350);
	}

	private isTrackedEagleReferencePath(fileOrPath: TFile | string) {
		const targetPath = typeof fileOrPath === 'string' ? fileOrPath : fileOrPath.path;
		return targetPath.endsWith('.md') || targetPath.endsWith('.canvas');
	}

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
		this.register(
			onElement(
				document,
				"contextmenu",
				"a.external-link, span.external-link, .cm-link, a.cm-underline, iframe, .eagle-embed-container video, .eagle-embed-container audio",
				eagleLinkContextMenuCall.bind(this),
				{ capture: true }
			)
		);
		registerCanvasDocument(this, document);
	}
	handleImage(img: HTMLImageElement, ctx: MarkdownPostProcessorContext): HTMLElement | null {
		try {
			if (!img.parentElement || !embedManager.shouldEmbed(img.src, img.alt)) return null;
			const embedResult = embedManager.create(img.src, img.alt, img.ownerDocument);
			const container = embedResult.containerEl;
			const wrapper = img.closest('.image-embed');
			const target = wrapper && wrapper.querySelectorAll('img').length === 1 ? wrapper : img;
			target.replaceWith(container);
			const child = new MarkdownRenderChild(container);
			child.register(embedResult.destroy);
			ctx.addChild(child);
			return container;
		} catch (error) {
			console.error("处理图像时出错:", error);
			return null;
		}
	}
}

