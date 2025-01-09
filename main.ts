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
		// 注册图片右键菜单事件
		this.registerDocument(document);
		this.app.workspace.on("window-open", (workspaceWindow, window) => {
			this.registerDocument(window.document);
		});
		// //注册新的链接点击事件
		// this.registerLinkClickEvent(document);
		// this.app.workspace.on("window-open", (workspaceWindow, window) => {
		// 	this.registerLinkClickEvent(window.document);
		// });
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

		this.registerDomEvent(document, "click", (event: MouseEvent) => {
			const target = event.target as HTMLElement;
			if (target.matches("span.external-link, a.external-link")) {
				event.preventDefault();
				event.stopPropagation();
				console.log('阻止默认的链接跳转行为');
				this.handleLinkClick(event);
			}
		}, { capture: true });
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
	// 注册图片右键菜单事件
	registerDocument(document: Document) {
		this.register(
			onElement(
				document,
				"mousedown",
				"img",
				this.eagleImageContextMenuCall.bind(this),
				// { capture: true }
			)
		);
	}
	// // 注册链接点击事件
	// registerLinkClickEvent(document: Document) {
	// 	this.register(
	// 		onElement(
	// 			document,
	// 			"click",
	// 			"span.external-link, a.external-link",
	// 			this.handleLinkClick.bind(this)
	// 		)
	// 	);
	// }
	// 处理链接点击事件
	handleLinkClick(event: MouseEvent) {
		// event.preventDefault(); // 阻止默认的跳转行为
		// event.stopPropagation(); // 阻止事件冒泡
		// 创建一个新的菜单实例
		const menu = new Menu();

		// 添加菜单项
		menu.addItem((item: MenuItem) =>
			item
				.setIcon("link")
				.setTitle("Open Link")
				.onClick(() => {
					const link = event.target as HTMLAnchorElement;
					if (link && link.href) {
						window.open(link.href, '_blank'); // 在新窗口中打开链接
					}
				})
		);

		menu.addItem((item: MenuItem) =>
			item
				.setIcon("clipboard")
				.setTitle("Copy Link")
				.onClick(() => {
					const link = event.target as HTMLAnchorElement;
					if (link && link.href) {
						navigator.clipboard.writeText(link.href);
						new Notice(`Copied: ${link.href}`);
					}
				})
		);

		// 显示菜单
		menu.showAtPosition({ x: event.pageX, y: event.pageY });
	}

	// handleLinkClick(event: MouseEvent) {
	// 	const link = event.target as HTMLAnchorElement;
	
	// 	// 验证目标元素
	// 	if (!link || !link.href) {
	// 		console.error("未找到有效的链接目标" + link);
	// 		return;
	// 	}
	
	// 	// 阻止默认行为
	// 	event.preventDefault();
	// 	event.stopPropagation(); // 如果有其他冒泡监听器，可以尝试阻止冒泡
	
	// 	console.log("阻止默认的链接跳转行为");
	// }
	// 处理外部图片的右键菜单事件
	eagleImageContextMenuCall(event: MouseEvent) {
		// 将事件目标转换为HTMLImageElement类型
		const img = event.target as HTMLImageElement;
		// 检查图片是否在表格中
		const inTable: boolean = img.closest('table') != null;
		// 检查图片是否在callout中
		const inCallout: boolean = img.closest('.callout') != null;
		// 如果图片的ID是'af-zoomed-image'，则返回
		if (img.id == 'af-zoomed-image') return;
		// 如果图片的src属性不是以'http'开头，则返回
		if (!img.src.startsWith('http')) return;
		// 如果事件的按钮不是右键（button值不为2），则返回
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
		//this.app.workspace.trigger("AttachFlow:contextmenu", menu);
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

		menu.addItem((item: MenuItem) =>
			item
				.setIcon("external-link")
				.setTitle("Open in windows")
				.onClick(async () => {
					const match = img.src.match(/\/images\/(.*)\.info/);
					if (match && match[1]) {
						const requestOptions: RequestInit = {
							method: 'GET',
							redirect: 'follow' as RequestRedirect
						};

						try {
							const response = await fetch(`http://localhost:41595/api/item/info?id=${match[1]}`, requestOptions);
							const result = await response.json();

							if (result.status === "success" && result.data) {
								const { id, name, ext } = result.data;
								const infoToCopy = `ID: ${id}, Name: ${name}, Ext: ${ext}`;
								navigator.clipboard.writeText(infoToCopy);
								new Notice(`Copied: ${infoToCopy}`);
							} else {
								console.log('Failed to fetch item info');
							}
						} catch (error) {
							console.log('Error fetching item info', error);
						}
					} else {
						console.log('Invalid image source format');
					}
				})
		);

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
