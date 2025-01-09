import { Menu,MenuItem,App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { startServer, refreshServer, stopServer } from './server';
import { handlePasteEvent } from './urlHandler';
import { onElement } from './onElement';

interface MyPluginSettings {
	mySetting: string;
	port: number;
	libraryPath: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default',
	port: 6060,
	libraryPath: ''
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		this.registerDocument(document);
		this.app.workspace.on("window-open", (workspaceWindow, window) => {
			this.registerDocument(window.document);
		});
		// 在插件加载时启动服务器
		startServer(this.settings.libraryPath, this.settings.port);

		// 添加设置面板
		this.addSettingTab(new SampleSettingTab(this.app, this));
		await this.loadSettings();
		// 注册粘贴事件
		this.registerEvent(
			this.app.workspace.on('editor-paste', (clipboard: ClipboardEvent, editor: Editor) => {
				handlePasteEvent(clipboard, editor, this.settings.port);
			})
		);
	}

	onunload() {
		// 在插件卸载时停止服务器
		stopServer();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
	registerDocument(document: Document) {
		this.register(
			onElement(
				document,
				"mousedown",
				"img",
				this.eagleImageContextMenuCall.bind(this)
			)
		);
	}
	// 处理外部图片的右键菜单事件
	eagleImageContextMenuCall(event: MouseEvent) {
		const img = event.target as HTMLImageElement;
		const inTable: boolean = img.closest('table') != null;
		const inCallout: boolean = img.closest('.callout') != null;
		if (img.id == 'af-zoomed-image') return;
		if (!img.src.startsWith('http')) return;
		if (event.button != 2) return;
		// 阻止默认的右键菜单事件
		event.preventDefault();
		this.app.workspace.getActiveViewOfType(MarkdownView)?.editor?.blur();
		img.classList.remove('image-ready-click-view', 'image-ready-resize');
		// 创建一个新的菜单实例
		const menu = new Menu();
		// 检查当前视图是否为预览模式
		const inPreview = this.app.workspace.getActiveViewOfType(MarkdownView)?.getMode() == "preview";
		// 如果在预览模式下，添加预览模式的菜单项
		if (inPreview) {
			this.addEagleImageMenuPreviewMode(menu, img);
		}
		// 否则，添加源模式的菜单项
		else {
			this.addEagleImageMenuSourceMode(menu, img, inTable, inCallout);
		}
		// 注册Esc键以关闭菜单
		this.registerEscapeButton(menu);
		let offset = 0;
		if (!inPreview && (inTable || inCallout)) offset = -138;
		menu.showAtPosition({ x: event.pageX, y: event.pageY + offset });
		this.app.workspace.trigger("AttachFlow:contextmenu", menu);
	}
	registerEscapeButton(menu: Menu, document: Document = activeDocument) {
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
	addEagleImageMenuPreviewMode = (menu: Menu, img: HTMLImageElement) => {
		menu.addItem((item: MenuItem) =>
			item
				.setIcon("link")
				.setTitle("To Eagle")
				.onClick(async () => {
					try {
						const match = img.src.match(/\/images\/(.*)\.info/);
						if (match && match[1]) {
							const eagleLink = `eagle://item/${match[1]}`;
							navigator.clipboard.writeText(eagleLink);
							window.open(eagleLink, '_self'); // 直接运行跳转到 eagle:// 链接
						} else {
							throw new Error('Invalid image source format');
						}
					}
					catch (error) {
						new Notice('Failed to Eagle');
					}
				})
		);
		menu.addItem(async (item: MenuItem) => {
			try {
				const response = await fetch(`${img.src}/name`);
				if (!response.ok) {
					throw new Error('Network response was not ok');
				}
				const imageName = await response.text();
				item.setIcon("link")
					.setTitle(`Eagle Name: ${imageName}`)
					.onClick(() => {
						navigator.clipboard.writeText(imageName);
						new Notice(`Copied: ${imageName}`);
					});
			} catch (error) {
				item.setIcon("link").setTitle("Failed to fetch image name");
			}
		});
		menu.addItem(async (item: MenuItem) => {
			try {
				const response = await fetch(`${img.src}/annotation`);
				if (!response.ok) {
					throw new Error('Network response was not ok');
				}
				const annotation = await response.text();
				item.setIcon("link")
					.setTitle(`Eagle Annotation: ${annotation}`)
					.onClick(() => {
						navigator.clipboard.writeText(annotation);
						new Notice(`Copied: ${annotation}`);
					});
			} catch (error) {
				item.setIcon("link").setTitle("Failed to fetch image annotation");
			}
		});
		menu.addItem(async (item: MenuItem) => {
			try {
				const response = await fetch(`${img.src}/tags`);
				if (!response.ok) {
					throw new Error('Network response was not ok');
				}
				const tags = await response.text();
				item.setIcon("link")
					.setTitle(`Eagle tags: ${tags}`)
					.onClick(() => {
						navigator.clipboard.writeText(tags);
						new Notice(`Copied: ${tags}`);
					});
			} catch (error) {
				item.setIcon("link").setTitle("Failed to fetch image tags");
			}
		});
		menu.addItem(async (item: MenuItem) => {
			try {
				const response = await fetch(`${img.src}/url`);
				if (!response.ok) {
					throw new Error('Network response was not ok');
				}
				const url = await response.text();
				item.setIcon("link")
					.setTitle(`Eagle URL: ${url}`)
					.onClick(() => {
						navigator.clipboard.writeText(url);
						new Notice(`Copied: ${url}`);
						window.open(url, '_self');
					});
			} catch (error) {
				item.setIcon("link").setTitle("Failed to fetch image url");
			}
		});

		// menu.addItem((item: MenuItem) =>
		// 	item
		// 		.setIcon("name")
		// 		.setTitle("Eagle Name")
		// 		.onClick(async () => {
		// 			try {
		// 				const response = await fetch(`${img.src}/name`);
		// 				if (!response.ok) {
		// 					throw new Error('Network response was not ok');
		// 				}
		// 				const imageName = await response.text();
		// 				new Notice(`Image Name: ${imageName}`);
		// 			} catch (error) {
		// 				new Notice('Failed to fetch image name');
		// 			}
		// 		})
		// );
		// menu.addItem((item: MenuItem) =>
		// 	item
		// 		.setIcon("name")
		// 		.setTitle("Eagle Name2[cs,Gh]")
		// );
		// menu.addItem((item: MenuItem) =>
		// 	item
		// 		.setIcon("external-link")
		// 		.setTitle("Open in external browser")
		// 		.onClick(async () => {
		// 			window.open(img.src, '_blank');
		// 		})
		// );
	}

	addEagleImageMenuSourceMode = (menu: Menu, img: HTMLImageElement, inTable: boolean, inCallout: boolean) => {
		this.addEagleImageMenuPreviewMode(menu, img);
		menu.addItem((item: MenuItem) =>
			item
				.setIcon("trash-2")
				.setTitle("Clear image link")
				// .onClick(() => {
				// 	// const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
				// 	// //  @ts-expect-error, not typed
				// 	// const editorView = editor.cm as EditorView;
				// 	// const target_pos = editorView.posAtDOM(img);
				// 	// deleteCurTargetLink(img.src, this, 'img', target_pos, inTable, inCallout);
				// })
				.onClick(async () => {
					navigator.clipboard.writeText(img.src);
				})
		);
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Port')
			.setDesc('Enter the port number for the server')
			.addText(text => text
				.setPlaceholder('Enter port number')
				.setValue(this.plugin.settings.port.toString())
				.onChange(async (value) => {
					this.plugin.settings.port = parseInt(value);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Library Path')
			.setDesc('Enter the library path for the server')
			.addText(text => text
				.setPlaceholder('Enter library path')
				.setValue(this.plugin.settings.libraryPath)
				.onChange(async (value) => {
					this.plugin.settings.libraryPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Refresh Server')
			.setDesc('Refresh the server with the new settings')
			.addButton(button => button
				.setButtonText('Refresh')
				.onClick(() => {
					refreshServer(this.plugin.settings.libraryPath, this.plugin.settings.port);
				}));
	}
}
