import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, Menu, MenuItem, TFile, MarkdownFileInfo } from 'obsidian';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { onElement } from "helpers"

let server: http.Server;
let isServerRunning = false;

// Remember to rename these classes and interfaces!

interface MyPluginSettings {
	port: number;
	libraryPath: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	port: 5050,
	libraryPath: ''
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();
		startServer(this.settings.libraryPath, this.settings.port);

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('dice', 'Sample Plugin', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			new Notice('This is a notice!');
		});
		// Perform additional things with the ribbon
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Status Bar Text');

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-sample-modal-simple',
			name: 'Open sample modal (simple)',
			callback: () => {
				new SampleModal(this.app).open();
			}
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'sample-editor-command',
			name: 'Sample editor command',
			editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
				if (ctx instanceof MarkdownView) {
					console.log(editor.getSelection());
					editor.replaceSelection('Sample Editor Command');
				}
			}
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-sample-modal-complex',
			name: 'Open sample modal (complex)',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new SampleModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
		this.addRibbonIcon("dice", "Start Server", () => {
			const libraryPath = (this.app.vault.adapter as any).basePath; // 获取 Obsidian 的库路径
			startServer(libraryPath, 8080);
		});

		this.addCommand({
			id: "stop-server",
			name: "Stop Server",
			callback: () => {
				stopServer();
			},
		});

		this.addCommand({
			id: 'convert-eagle-link',
			name: 'Convert Eagle Link',
			editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
				if (ctx instanceof MarkdownView) {
					const content = editor.getValue();
					console.log('Original Content:', content);

					const updatedContent = content.replace(/eagle:\/\/item\/(\w+)/g, (match, p1) => {
						console.log('Matched:', match, 'ID:', p1);
						return `![](http://localhost:${this.settings.port}/images/${p1}.info)`;
					});

					editor.setValue(updatedContent);
					console.log('Updated Content:', updatedContent);
				}
			}
		});

		this.registerEvent(
			this.app.workspace.on('editor-paste', this.handlePasteEvent.bind(this))
		);

		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file, source) => {
				if (file instanceof TFile && file.extension.match(/(jpg|jpeg|png|gif)/i)) {
					this.addLinkEagleMenuItem(menu, file, source);
				}
			})
		);

		// 使用 onElement 注册右键菜单事件
		this.register(
			() => {
				const handler = onElement(
					document,
					"contextmenu" as keyof HTMLElementEventMap,
					"img, iframe, video, div.file-embed-title, audio",
					this.onRightClickMenu.bind(this)
				);
				const unregister = handler();
				return unregister;
			}
		);

		// 更新菜单选项
		this.addCommand({
			id: "refresh-server",
			name: "Refresh Server",
			callback: () => {
				refreshServer();
			},
		});
	}

	onunload() {
		stopServer();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async handlePasteEvent(clipboard: ClipboardEvent, editor: Editor): Promise<void> {
		let clipboardText = clipboard.clipboardData?.getData('text/plain');
		if (!clipboardText) return;

		// 检查是否为Eagle链接
		if (/eagle:\/\/item\/(\w+)/.test(clipboardText)) {
			const updatedText = clipboardText.replace(/eagle:\/\/item\/(\w+)/g, (match, p1) => {
				return `![](http://localhost:${this.settings.port}/images/${p1}.info)`;
			});
			editor.replaceSelection(updatedText);
			clipboard.preventDefault(); // 阻止默认粘贴行为
			new Notice('Eagle链接已转换');
		}
	}

	addLinkEagleMenuItem(menu: Menu, imgPath: string, file: TFile, source: any) {
		menu.addItem((item: MenuItem) => {
			item.setTitle('Link Eagle')
				.setIcon('link')
				.onClick(() => {
					const imagePath = file.path;
					const match = imagePath.match(/images\/(\w+)\.info/);
					if (match) {
						const eagleId = match[1];
						const eagleLink = `eagle://item/${eagleId}`;
						new Notice(`Eagle Link: ${eagleLink}`);
						this.openEagleLink(eagleLink);
					} else {
						new Notice('无法获取Eagle链接');
					}
				});
		});
	}

	openEagleLink(link: string) {
		window.open(link);
		console.log(`Opening Eagle Link: ${link}`);
	}

	onRightClickMenu(event: MouseEvent) {
		const target = event.target as HTMLElement;
		const nodeType = target.localName;

		// 检查是否点击了支持的元素类型
		const supportedTypes = ["img", "iframe", "video", "div", "audio"];
		if (!supportedTypes.includes(nodeType)) return;

		event.preventDefault(); // 阻止默认右键菜单

		const currentMd = this.app.workspace.getActiveFile() as TFile;
		const menu = new Menu();

		// 获取元素路径
		const imgPath = target.getAttribute("src") || "";

		// 添加自定义菜单项
		this.addLinkEagleMenuItem(menu, imgPath, currentMd, source);

		// 显示菜单
		menu.showAtPosition({ x: event.pageX, y: event.pageY });
	}


}

// 创建本地服务器
function startServer(libraryPath: string, port: number) {
	if (isServerRunning) return;
	server = http.createServer((req, res) => {
		const filePath = path.join(libraryPath, req.url || '');
		console.log('Requested file path:', filePath);

		fs.stat(filePath, (err, stats) => {
			if (err) {
				console.error('Error accessing file path:', err);
				res.writeHead(404, {'Content-Type': 'text/plain'});
				res.end('Not Found');
			} else if (stats.isDirectory()) {
				const jsonFilePath = path.join(filePath, 'metadata.json');
				fs.readFile(jsonFilePath, 'utf8', (err, data) => {
					if (err) {
						console.error('Error reading JSON file:', err);
						res.writeHead(500, {'Content-Type': 'text/plain'});
						res.end('Internal Server Error');
					} else {
						try {
							const info = JSON.parse(data);
							const imageName = info.name;
							const imageExt = info.ext;
							const imageFile = `${imageName}.${imageExt}`;
							const imagePath = path.join(filePath, imageFile);

							fs.readFile(imagePath, (err, data) => {
								if (err) {
									console.error('Error reading image file:', err);
									res.writeHead(404, {'Content-Type': 'text/plain'});
									res.end('Image not found');
								} else {
									res.writeHead(200, {'Content-Type': 'image/jpeg'});
									res.end(data);
								}
							});
						} catch (parseErr) {
							console.error('Error parsing JSON:', parseErr);
							res.writeHead(500, {'Content-Type': 'text/plain'});
							res.end('Error parsing JSON');
						}
					}
				});
			} else {
				fs.readFile(filePath, (err, data) => {
					if (err) {
						console.error('Error reading file:', err);
						res.writeHead(500, {'Content-Type': 'text/plain'});
						res.end('Internal Server Error');
					} else {
						res.writeHead(200, {'Content-Type': 'image/jpeg'});
						res.end(data);
					}
				});
			}
		});
	});

	server.listen(port, () => {
		isServerRunning = true;
		console.log(`Server is running at http://localhost:${port}/`);
	});
}

function stopServer() {
	if (!isServerRunning) return;
	server.close(() => {
		isServerRunning = false;
		console.log('Server stopped.');
	});
}

function refreshServer() {
	if (!isServerRunning) return;
	server.close(() => {
		isServerRunning = false;
		console.log('Server stopped for refresh.');
		startServer(DEFAULT_SETTINGS.libraryPath, DEFAULT_SETTINGS.port);
		console.log('Server restarted.');
	});
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Server Port')
			.setDesc('Enter the port number for the server.')
			.addText(text => text
				.setPlaceholder('5050')
				.setValue(this.plugin.settings.port.toString())
				.onChange(async (value) => {
					this.plugin.settings.port = parseInt(value);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Library Path')
			.setDesc('Enter the library path for the server.')
			.addText(text => text
				.setPlaceholder('/path/to/library')
				.setValue(this.plugin.settings.libraryPath)
				.onChange(async (value) => {
					this.plugin.settings.libraryPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Server Control')
			.setDesc('Start or stop the server.')
			.addButton(button => {
				button.setButtonText(isServerRunning ? 'Stop Server' : 'Start Server')
					.onClick(async () => {
						if (isServerRunning) {
							stopServer();
							button.setButtonText('Start Server');
						} else {
							startServer(this.plugin.settings.libraryPath, this.plugin.settings.port);
							button.setButtonText('Stop Server');
						}
					});
			});
	}
}
