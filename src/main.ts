import { Menu,MenuItem,App, Editor, MarkdownView, Modal, Notice, Plugin, Setting,TFile, Platform, FileStats } from 'obsidian';
import { startServer, refreshServer, stopServer } from './server';
import { handlePasteEvent, handleDropEvent } from './urlHandler';
import { onElement } from './onElement';
import { exec, spawn, execSync } from 'child_process';
import * as path from 'path';
import { addCommandSynchronizedPageTabs,addCommandEagleJump } from "./addCommand-config";
import { existsSync } from 'fs';
import { MyPluginSettings, DEFAULT_SETTINGS, SampleSettingTab } from './setting';
import { handleImageClick, removeZoomedImage } from './Leftclickimage';
import { handleLinkClick, eagleImageContextMenuCall, registerEscapeButton, addEagleImageMenuSourceMode, addEagleImageMenuPreviewMode, fetchImageInfo } from './menucall';
import { isLinkToImage, isURL, isLocalHostLink, isAltTextImage } from './embed';
import { embedManager } from './embed';
import { embedField } from './embed-state-field';
import { Extension } from "@codemirror/state";


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

	async onload() {
		console.log('加载 Eagle-Embed 插件');
		
		await this.loadSettings();
		
		// 注册编辑器扩展，务必正确导入和注册
		this.registerEditorExtension([embedField]);
		
		// 处理预览模式
		this.registerMarkdownPostProcessor((el, ctx) => {
			const images = el.querySelectorAll('img');
			images.forEach((image) => {
				if (isURL(image.src) && embedManager.shouldEmbed(image.src)) {
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
		// 在插件加载时设置 DEBUG 状态
		// console.log('Debug setting:', this.settings.debug);
		setDebug(this.settings.debug);

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
		addCommandEagleJump(this);
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
		// this.app.vault.getResourcePath = this.originalGetResourcePath;
		// this.app.metadataCache.getFirstLinkpathDest = this.originalGetFirstLinkpathDest;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
	// 注册图片右键菜单事件
	registerDocument(document: Document) {
		this.register(
			onElement(
				document,
				"mousedown",
				"img",
				eagleImageContextMenuCall.bind(this),
				// { capture: true }
			)
		);
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
			const iframe = embedResult.iframeEl;
			
			if (!img.parentElement) {
				// print("错误: 图像没有父元素");
				return null;
			}
			
			// 使用替换方法
			img.parentElement.replaceChild(container, img);
			
			if (iframe) {
				// 设置iframe事件处理
				iframe.onerror = () => {
					// print("嵌入加载失败: 显示原始图像");
					container.classList.add("auto-embed-hide-display");
				};
				
				iframe.onload = () => {
					// print("嵌入加载成功");
					container.classList.remove("auto-embed-hide-display");
				};
			}
			
			return container;
		} catch (error) {
			console.error("处理图像时出错:", error);
			return null;
		}
	}
}

