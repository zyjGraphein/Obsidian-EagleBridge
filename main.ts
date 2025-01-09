import { Menu,MenuItem,App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { startServer, refreshServer, stopServer } from './server';
import { handlePasteEvent } from './urlHandler';
import { onElement } from './onElement';
import { exec, spawn } from 'child_process';
import * as path from 'path';

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

		// 确保 event 是 MouseEvent 类型
		if (event instanceof MouseEvent) {
			const menu = new Menu();
			const inPreview = this.app.workspace.getActiveViewOfType(MarkdownView)?.getMode() == "preview";
			if (inPreview) {
				this.addEagleImageMenuPreviewMode(menu, img, event); // 确保传递了 event 参数
			} else {
				this.addEagleImageMenuSourceMode(menu, img, inTable, inCallout, event);
			}
			// 注册Esc键以关闭菜单
			this.registerEscapeButton(menu);
			let offset = 0;
			if (!inPreview && (inTable || inCallout)) offset = -138;
			menu.showAtPosition({ x: event.pageX, y: event.pageY + offset });
		}
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
	// 获取图片信息
	async fetchImageInfo(img: HTMLImageElement): Promise<{ id: string, name: string, ext: string, annotation: string, tags: string, url: string } | null> {
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
					return result.data;
				} else {
					console.log('Failed to fetch item info');
				}
			} catch (error) {
				console.log('Error fetching item info', error);
			}
		} else {
			console.log('Invalid image source format');
		}
		return null;
	}
	
	async addEagleImageMenuPreviewMode(menu: Menu, img: HTMLImageElement, event: MouseEvent) {
		const imageInfo = await this.fetchImageInfo(img);

		if (imageInfo) {
			const { id, name, ext, annotation, tags, url } = imageInfo;
			// const infoToCopy = `ID: ${id}, Name: ${name}, Ext: ${ext}, Annotation: ${annotation}, Tags: ${tags}, URL: ${url}`;
			// navigator.clipboard.writeText(infoToCopy);
			// new Notice(`Copied: ${infoToCopy}`);

			menu.addItem((item: MenuItem) =>
				item
					.setIcon("external-link")
					.setTitle("Open in eagle")
					.onClick(() => {
						const eagleLink = `eagle://item/${id}`;
						navigator.clipboard.writeText(eagleLink);
						window.open(eagleLink, '_self'); // 直接运行跳转到 eagle:// 链接
					})
			);

			menu.addItem((item: MenuItem) =>
				item
					.setIcon("external-link")
					.setTitle("Open in windows")
					.onClick(() => {
						const libraryPath = this.settings.libraryPath;
						const localFilePath = path.join(
							libraryPath,
							"images",
							`${id}.info`,
							`${name}.${ext}`
						);
			
						// 打印路径用于调试
						new Notice(`文件的真实路径是: ${localFilePath}`);
						console.log(`文件的真实路径是: ${localFilePath}`);
			
						// 使用 spawn 调用 explorer.exe 打开文件
						const child = spawn('explorer.exe', [localFilePath], { shell: true });

						child.on('error', (error) => {
							console.error('Error opening file:', error);
							new Notice('无法打开文件，请检查路径是否正确');
						});

						child.on('exit', (code) => {
							if (code === 0) {
								console.log('文件已成功打开');
							} else {
								console.error('文件未能正常打开，exit code:', code);
							}
						});
					})
			);
			
			menu.addItem((item: MenuItem) =>
				item
					.setIcon("link")
					.setTitle(`Eagle Name: ${name}`)
					.onClick(() => {
						navigator.clipboard.writeText(name);
						new Notice(`Copied: ${name}`);
					})
			);

			menu.addItem((item: MenuItem) =>
				item
					.setIcon("link")
					.setTitle(`Eagle Annotation: ${annotation}`)
					.onClick(() => {
						navigator.clipboard.writeText(annotation);
						new Notice(`Copied: ${annotation}`);
					})
			);

			menu.addItem((item: MenuItem) =>
				item
					.setIcon("link")
					.setTitle(`Eagle url: ${url}`)
					.onClick(() => {
						navigator.clipboard.writeText(url);
						new Notice(`Copied: ${url}`);
					})
			);



			// 其他菜单项可以继续使用 { id, name, ext } 数据
		}

		// 确保菜单在异步操作后显示
		menu.showAtPosition({ x: event.pageX, y: event.pageY });
	}

	async addEagleImageMenuSourceMode(menu: Menu, img: HTMLImageElement, inTable: boolean, inCallout: boolean, event: MouseEvent) {
		await this.addEagleImageMenuPreviewMode(menu, img, event);

		// // 调试输出，确认函数被调用
		// console.log("addEagleImageMenuSourceMode called");

		// // 调试输出，确认菜单项添加
		// console.log("Adding 'Clear image link' menu item");

		menu.addItem((item: MenuItem) =>
			item
				.setIcon("trash-2")
				.setTitle("Clear image link")
				.onClick(async () => {
					navigator.clipboard.writeText(img.src);
					new Notice(`Copied: ${img.src}`);
				})
		);

		// 确保菜单在异步操作后显示
		menu.showAtPosition({ x: event.pageX, y: event.pageY });
		// console.log("Menu shown at position", { x: event.pageX, y: event.pageY });
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
