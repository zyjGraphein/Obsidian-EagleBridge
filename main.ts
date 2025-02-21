import { Menu,MenuItem,App, Editor, MarkdownView, Modal, Notice, Plugin, Setting } from 'obsidian';
import { startServer, refreshServer, stopServer } from './server';
import { handlePasteEvent, handleDropEvent } from './urlHandler';
import { onElement } from './onElement';
import { exec, spawn, execSync } from 'child_process';
import * as path from 'path';
import { addCommandSynchronizedPageTabs,addCommandEagleJump } from "./addCommand-config";
import { existsSync } from 'fs';
import { MyPluginSettings, DEFAULT_SETTINGS, SampleSettingTab } from './setting';
import { handleImageClick, removeZoomedImage } from './Leftclickimage';
import { handleLinkClick, eagleImageContextMenuCall, registerEscapeButton, addEagleImageMenuSourceMode, addEagleImageMenuPreviewMode } from './menucall';

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
		await this.loadSettings();
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
				print('未找到活动视图');
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
					print('预览模式下的链接:', url);
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
						print('光标位于链接区间:', i + 1);
						break;
					}
				}

				if (closestUrl) {
					url = closestUrl;
					print('编辑模式下的链接:', url);
				}
			}

			if (url && url.match(/^http:\/\/localhost:\d+\/images\/[^.]+\.info$/)) {
				event.preventDefault();
				event.stopPropagation();
				print('阻止了链接:', url);
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
		// 添加自定义样式
		const style = document.createElement('style');
		style.textContent = `
			.menu-item {
				max-width: 800px; /* 设置最大宽度 */
				white-space: normal; /* 允许换行 */
				word-wrap: break-word; /* 自动换行 */
			}
		`;
		document.head.appendChild(style);
	}

	onunload() {
		// 在插件卸载时停止服务器
		stopServer();
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
}
