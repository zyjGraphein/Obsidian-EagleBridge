import { Menu,MenuItem,App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { startServer, refreshServer, stopServer } from './server';
import { handlePasteEvent, handleDropEvent } from './urlHandler';
import { onElement } from './onElement';
import { exec, spawn, execSync } from 'child_process';
import * as path from 'path';
import { addCommandSynchronizedPageTabs,addCommandEagleJump } from "./addCommand-config";
import { existsSync } from 'fs';

export interface MyPluginSettings {
	mySetting: string;
	port: number;
	libraryPath: string;
	folderId?: string;
	clickView: boolean;
	adaptiveRatio: number;
	advancedID: boolean;
	obsidianStoreId: string;
	imageSize: number | undefined;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default',
	port: 6060,
	libraryPath: '',
	folderId: '',
	clickView: false,
	adaptiveRatio: 0.8,
	advancedID: false,
	obsidianStoreId: '',
	imageSize: undefined
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

		this.registerDomEvent(document, "click", async (event: MouseEvent) => {
			const target = event.target as HTMLElement;

			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!activeView) {
				console.log('未找到活动视图');
				return;
			}

			const inPreview = activeView.getMode() === "preview";

			let url: string | null = null;

			if (inPreview) {
				// 预览模式下的处理逻辑
				if (!target.matches("a.external-link")) {
					return; // 如果不是点击 a.external-link，直接返回
				}

				const linkElement = target as HTMLAnchorElement;
				if (linkElement && linkElement.href) {
					url = linkElement.href;
					console.log('预览模式下的链接:', url);
				}
			} else {
				// 编辑模式下的处理逻辑
				if (!target.matches("span.external-link, .cm-link, a.cm-underline")) {
					return; // 如果不是点击 span.external-link, .cm-link 或 a.cm-underline，直接返回
				}

				const editor = activeView.editor;
				const cursor = editor.getCursor();
				const lineText = editor.getLine(cursor.line);

				// 使用正则表达式提取所有 URL
				const urlMatches = Array.from(lineText.matchAll(/\bhttps?:\/\/[^\s)]+/g));
				console.log(urlMatches);
				let closestUrl = null;
				let minDistance = Infinity;

				
				// 获取光标在行中的位置
				const cursorPos = cursor.ch;
				console.log(cursorPos);

				// 遍历所有匹配的 URL，找到光标位置所在的 URL 区间
				for (let i = 0; i < urlMatches.length; i++) {
					const match = urlMatches[i];
					const end = (match.index || 0) + match[0].length + 1;

					// 判断光标位置是否在当前 URL 的区间内
					if (cursorPos <= end) {
						closestUrl = match[0];
						console.log('光标位于链接区间:', i + 1);
						break; // 找到后退出循环
					}
				}

				if (closestUrl) {
					url = closestUrl;
					console.log('编辑模式下的链接:', url);
				}
			}

			// 检查链接格式
			if (url && url.match(/^http:\/\/localhost:\d+\/images\/[^.]+\.info$/)) {
				event.preventDefault();
				event.stopPropagation();
				console.log('阻止了链接:', url);
				this.handleLinkClick(event, url);
			} else {
				return; // 如果链接不符合条件，直接返回
			}
		}, { capture: true });
		// 注册点击事件(参考AttachFlow)
		this.registerDomEvent(document, 'click', async (evt: MouseEvent) => {
			// 检查设置中是否启用了点击查看功能
			if (!this.settings.clickView) return;
			
			// 获取点击事件的目标元素
			const target = evt.target as HTMLElement;
			
			// 如果目标元素不是图片，移除任何现有的放大图片并返回
			if (target.tagName !== 'IMG') {
				this.removeZoomedImage();
				return;
			}
			
			// 获取图片的边界矩形
			const rect = target.getBoundingClientRect();
			
			// 计算图片的中心位置
			const imageCenter = rect.left + rect.width / 2;
			
			// 如果点击位置在图片的左半部分或已经存在放大图片，则返回
			if (evt.clientX <= imageCenter || document.getElementById('af-zoomed-image')) return;
			
			// 阻止默认的点击行为
			evt.preventDefault();
			
			// 创建一个遮罩层
			const mask = createZoomMask();
			
			// 创建放大的图片，并获取其原始宽度和高度
			const { zoomedImage, originalWidth, originalHeight } = await createZoomedImage((target as HTMLImageElement).src, this.settings.adaptiveRatio);
			
			// 创建一个显示缩放比例的元素
			const scaleDiv = createZoomScaleDiv(zoomedImage, originalWidth, originalHeight);
			
			// 为放大的图片添加滚轮事件监听器，用于缩放
			zoomedImage.addEventListener('wheel', (e) => handleZoomMouseWheel(e, zoomedImage, originalWidth, originalHeight, scaleDiv));
			
			// 为放大的图片添加右键菜单事件监听器，用于重置大小
			zoomedImage.addEventListener('contextmenu', (e) => handleZoomContextMenu(e, zoomedImage, originalWidth, originalHeight, scaleDiv));
			
			// 为放大的图片添加鼠标按下事件监听器，用于拖动
			zoomedImage.addEventListener('mousedown', (e) => handleZoomDragStart(e, zoomedImage));
			
			// 为放大的图片添加双击事件监听器，用于自适应显示
			zoomedImage.addEventListener('dblclick', (e) => {
				adaptivelyDisplayImage(zoomedImage, originalWidth, originalHeight, this.settings.adaptiveRatio);
				updateZoomScaleDiv(scaleDiv, zoomedImage, originalWidth, originalHeight);
			});
		});

		this.registerDomEvent(document, 'keydown', (evt: KeyboardEvent) => {
			// 如果按下的是 Escape 键，移除放大的图片
			if (evt.key === 'Escape') {
				this.removeZoomedImage();
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
	// 移除放大图片
	removeZoomedImage() {
		if (document.getElementById('af-zoomed-image')) {
			const zoomedImage = document.getElementById('af-zoomed-image');
			if (zoomedImage) document.body.removeChild(zoomedImage);
			const scaleDiv = document.getElementById('af-scale-div');
			if (scaleDiv) document.body.removeChild(scaleDiv);
			const mask = document.getElementById('af-mask');
			if (mask) document.body.removeChild(mask);
		}
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
	handleLinkClick(event: MouseEvent, url: string) {
		if (event instanceof MouseEvent) {
			const menu = new Menu();
			const inPreview = this.app.workspace.getActiveViewOfType(MarkdownView)?.getMode() == "preview";
			if (inPreview) {
				this.addEagleImageMenuPreviewMode(menu, url, event); // 确保传递了 event 参数
			} else {
				this.addEagleImageMenuSourceMode(menu, url, event);
			}
			// 注册Esc键以关闭菜单
			this.registerEscapeButton(menu);
			let offset = 0;
			// if (!inPreview && (inTable || inCallout)) offset = -138;
			menu.showAtPosition({ x: event.pageX, y: event.pageY + offset });
		}
	}
	// 	const target = event.target as HTMLElement;
	// 	if (target.matches(".cm-formatting-link-string")) {
	// 		console.log('链接地址1:', target);
	// 		// event.preventDefault();
	// 		// event.stopPropagation();
	// 		const linkElement = target.closest('.cm-line')?.querySelector('.cm-header.cm-string.cm-url');
	// 		console.log('链接地址2:', linkElement);
	// 		if (linkElement) {
	// 			const link = linkElement.textContent;
	// 			if (link) {
	// 				console.log('链接地址:', link);
	// 				// 你可以在这里处理链接，例如打开链接或复制到剪贴板
	// 			}
	// 		}
	// 	}
	// 	// event.preventDefault(); // 阻止默认的跳转行为
	// 	// event.stopPropagation(); // 阻止事件冒泡
	// 	// 创建一个新的菜单实例
	// 	// const linkElement = target.closest('.cm-line')?.querySelector('.cm-header.cm-string.cm-url');
    //     // if (linkElement) {
    //     //     const link = linkElement.textContent;
    //     //     if (link) {
    //     //         console.log('链接地址:', link);
    //     //         // 你可以在这里处理链接，例如打开链接或复制到剪贴板
    //     //     }
    //     // }
	// 	const menu = new Menu();

	// 	// 添加菜单项
	// 	menu.addItem((item: MenuItem) =>
	// 		item
	// 			.setIcon("link")
	// 			.setTitle("Open Link")
	// 			.onClick(() => {
	// 				const link = event.target as HTMLAnchorElement;
	// 				if (link && link.href) {
	// 					window.open(link.href, '_blank'); // 在新窗口中打开链接
	// 				}
	// 			})
	// 	);

	// 	menu.addItem((item: MenuItem) =>
	// 		item
	// 			.setIcon("clipboard")
	// 			.setTitle("Copy Link")
	// 			.onClick(() => {
	// 				const link = event.target as HTMLAnchorElement;
	// 				if (link && link.href) {
	// 					navigator.clipboard.writeText(link.href);
	// 					new Notice(`Copied: ${link.href}`);
	// 				}
	// 			})
	// 	);

	// 	// 显示菜单
	// 	menu.showAtPosition({ x: event.pageX, y: event.pageY });
	// }

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
		const url = img.src;
		// console.log('链接:', url);	
		// 确保 event 是 MouseEvent 类型
		if (event instanceof MouseEvent) {
			const menu = new Menu();
			const inPreview = this.app.workspace.getActiveViewOfType(MarkdownView)?.getMode() == "preview";
			if (inPreview) {
				this.addEagleImageMenuPreviewMode(menu, url, event); // 确保传递了 event 参数
			} else {
				this.addEagleImageMenuSourceMode(menu, url, event);
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
	async fetchImageInfo(url: string): Promise<{ id: string, name: string, ext: string, annotation: string, tags: string, url: string } | null> {
		const match = url.match(/\/images\/(.*)\.info/);
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
	
	async addEagleImageMenuPreviewMode(menu: Menu, oburl: string, event: MouseEvent) {
		const imageInfo = await this.fetchImageInfo(oburl);

		if (imageInfo) {
			const { id, name, ext, annotation, tags, url } = imageInfo;
			// const infoToCopy = `ID: ${id}, Name: ${name}, Ext: ${ext}, Annotation: ${annotation}, Tags: ${tags}, URL: ${url}`;
			// navigator.clipboard.writeText(infoToCopy);
			// new Notice(`Copied: ${infoToCopy}`);
			menu.addItem((item: MenuItem) =>
				item
					.setIcon("file-symlink")
					.setTitle("Open in obsidian")
					.onClick((event: MouseEvent) => {
						// console.log(oburl);
						window.open(oburl, '_blank');
					})
			);
			
			menu.addItem((item: MenuItem) =>
				item
					.setIcon("file-symlink")
					.setTitle("Open in eagle")
					.onClick(() => {
						const eagleLink = `eagle://item/${id}`;
						navigator.clipboard.writeText(eagleLink);
						window.open(eagleLink, '_self'); // 直接运行跳转到 eagle:// 链接
					})
			);

			menu.addItem((item: MenuItem) =>
				item
					.setIcon("square-arrow-out-up-right")
					.setTitle("Open in the default app")
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
					.setIcon("external-link")
					.setTitle("Open in other apps")
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
			
						// 使用 rundll32 调用系统的"打开方式"对话框
						const child = spawn('rundll32', ['shell32.dll,OpenAs_RunDLL', localFilePath], { shell: true });

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
			// 复制源文件
			menu.addItem((item: MenuItem) =>
			item
				.setIcon("copy")
				.setTitle("Copy source file")
				.onClick(() => {
					const libraryPath = this.settings.libraryPath;
					const localFilePath = path.join(
						libraryPath,
						"images",
						`${id}.info`,
						`${name}.${ext}`
					);
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
						navigator.clipboard.writeText(url);
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
						new ModifyPropertiesModal(this.app, id, name, annotation, url, tagsArray, (newId, newName, newAnnotation, newUrl, newTags) => {
							// new Notice(`Name changed to: ${newName}`);
							// 在这里处理保存逻辑
						}).open();
					})
			);
			// 其他菜单项可以继续使用 { id, name, ext } 数据
		}

		// 确保菜单在异步操作后显示
		menu.showAtPosition({ x: event.pageX, y: event.pageY });
	}

	async addEagleImageMenuSourceMode(menu: Menu, url: string, event: MouseEvent) {
		await this.addEagleImageMenuPreviewMode(menu, url, event);

		// // 调试输出，确认函数被调用
		// console.log("addEagleImageMenuSourceMode called");

		// // 调试输出，确认菜单项添加
		// console.log("Adding 'Clear image link' menu item");
		menu.addItem((item: MenuItem) =>
			item
				.setIcon("copy")
				.setTitle("Copy markdown link")
				.onClick(async () => {
					const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
					if (!editor) {
						new Notice('未找到活动编辑器');
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
							new Notice('链接已复制');
							linkFound = true;
							break; // 找到并复制后退出循环
						}
					}

					if (!linkFound) {
						new Notice('未找到链接');
					}
				})
		);
		menu.addItem((item: MenuItem) =>
			item
				.setIcon("trash-2")
				.setTitle("Clear markdown link")
				.onClick(() => {
					const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
					if (!editor) {
						new Notice('未找到活动编辑器');
						return;
					}

					const doc = editor.getDoc();
					const lineCount = doc.lineCount();

					let linkFound = false;

					for (let line = 0; line < lineCount; line++) {
						const lineText = doc.getLine(line);

						// 使用正则表达式查找 Markdown 链接，匹配带叹号和不带叹号的链接
						const regex = new RegExp(`!?\\[.*?\\]\\(${url}\\)`, 'g');
						const match = regex.exec(lineText);

						if (match) {
							const from = { line: line, ch: match.index };
							const to = { line: line, ch: match.index + match[0].length };
							doc.replaceRange('', from, to);
							new Notice('链接已删除');
							linkFound = true;
							break; // 找到并删除后退出循环
						}
					}

					if (!linkFound) {
						new Notice('未找到链接');
					}
				})
		);


		// //this.app.metadataCache.resolvedLinks 在 Obsidian 中主要用于解析内部链接（即 Vault 内部的文件链接），而不适用于外部链接（如 HTTP/HTTPS 链接）。遍历所有的文档速度太慢，需要优化。
		// menu.addItem((item: MenuItem) =>
		// 	item
		// 		.setIcon("trash-2")
		// 		.setTitle("Clear file and link")
		// 		.onClick(async () => {
		// 			const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
		// 			if (!editor) {
		// 				new Notice('未找到活动编辑器');
		// 				return;
		// 			}

		// 			const doc = editor.getDoc();
		// 			const lineCount = doc.lineCount();
		// 			let linkCountInCurrentDoc = 0;
		// 			const id = "M5U4IDJGU4PSE.info"; // 仅匹配 ID

		// 			// 检查当前文档中链接的出现次数
		// 			for (let line = 0; line < lineCount; line++) {
		// 				const lineText = doc.getLine(line);
		// 				const regex = new RegExp(id, 'g');
		// 				if (regex.test(lineText)) {
		// 					linkCountInCurrentDoc++;
		// 				}
		// 			}

		// 			if (linkCountInCurrentDoc > 1) {
		// 				// 如果链接在当前文档中出现多次，仅删除当前选中的链接
		// 				for (let line = 0; line < lineCount; line++) {
		// 					const lineText = doc.getLine(line);
		// 					const regex = new RegExp(id, 'g');
		// 					const match = regex.exec(lineText);

		// 					if (match) {
		// 						const from = { line: line, ch: match.index };
		// 						const to = { line: line, ch: match.index + match[0].length };
		// 						doc.replaceRange('', from, to);
		// 						new Notice('链接已删除');
		// 						return;
		// 					}
		// 				}
		// 			} else {
		// 				// 手动遍历所有 Markdown 文件，检查 ID
		// 				const allFiles = this.app.vault.getMarkdownFiles();
		// 				let linkFoundElsewhere = false;

		// 				for (const file of allFiles) {
		// 					const content = await this.app.vault.read(file);
		// 					const regex = new RegExp(id, 'g');
		// 					if (regex.test(content)) {
		// 						linkFoundElsewhere = true;
		// 						break;
		// 					}
		// 				}

		// 				if (linkFoundElsewhere) {
		// 					// 仅删除当前文档中的链接
		// 					for (let line = 0; line < lineCount; line++) {
		// 						const lineText = doc.getLine(line);
		// 						const regex = new RegExp(id, 'g');
		// 						const match = regex.exec(lineText);

		// 						if (match) {
		// 							const from = { line: line, ch: match.index };
		// 							const to = { line: line, ch: match.index + match[0].length };
		// 							doc.replaceRange('', from, to);
		// 							new Notice('链接已删除，其余文档依旧引用该图片');
		// 							return;
		// 						}
		// 					}
		// 				} else {
		// 					// 删除源文件
		// 					const data = { "itemIds": [id] }; // 将 id 放入数组中

		// 					const requestOptions: RequestInit = {
		// 						method: 'POST',
		// 						body: JSON.stringify(data),
		// 						redirect: 'follow'
		// 					};

		// 					fetch("http://localhost:41595/api/item/moveToTrash", requestOptions)
		// 						.then(response => response.json())
		// 						.then(result => {
		// 							console.log(result);
		// 							new Notice('文件已删除');
		// 						})
		// 						.catch(error => {
		// 							console.log('error', error);
		// 							new Notice('删除文件时出错');
		// 						});
		// 				}
		// 			}
		// 		})
		// );

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
			.setName('Folder ID')
			.setDesc('Enter the folder ID for Eagle')
			.addText(text => text
				.setPlaceholder('Enter folder ID')
				.setValue(this.plugin.settings.folderId || '')
				.onChange(async (value) => {
					this.plugin.settings.folderId = value;
					await this.plugin.saveSettings();
				}));
        new Setting(containerEl)
            .setName("Click to view images")
            .setDesc("Click the right half of the image to view the image in detail.")
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.clickView)
                    .onChange(async (value) => {
                        this.plugin.settings.clickView = value;
                        await this.plugin.saveSettings();
                    });
            });
		new Setting(containerEl)
            .setName("Synchronizing advanced URIs as labels")
            .setDesc("Synchronize advanced URIs as tags when page ids exist.")
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.advancedID)
                    .onChange(async (value) => {
                        this.plugin.settings.advancedID = value;
                        await this.plugin.saveSettings();
                    });
            });
		new Setting(containerEl)
			.setName('Obsidian store ID')
			.setDesc('Enter the Obsidian store ID')
			.addText(text => text
				.setPlaceholder('Enter Obsidian store ID')
				.setValue(this.plugin.settings.obsidianStoreId)
				.onChange(async (value) => {
					this.plugin.settings.obsidianStoreId = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
            .setName('Adaptive image display ratio based on window size')
            .setDesc('When the image exceeds the window size, the image is displayed adaptively according to the window size.')
            .addSlider((slider) => {
                slider.setLimits(0.1, 1, 0.05);
                slider.setValue(this.plugin.settings.adaptiveRatio);
                slider.onChange(async (value) => {
                    this.plugin.settings.adaptiveRatio = value;
                    new Notice(`Adaptive ratio: ${value}`);
                    await this.plugin.saveSettings();
                });
                slider.setDynamicTooltip();
            });

		new Setting(containerEl)
		.setName('Image size')
		.setDesc('Image default size')
		.addText(text => text
			.setPlaceholder('Enter image size')
			.setValue(this.plugin.settings.imageSize?.toString() || '')
			.onChange(async (value) => {
				this.plugin.settings.imageSize = value ? parseInt(value) : undefined;
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

// 定义一个新的 Modal 类
class ModifyPropertiesModal extends Modal {
	id: string;
	name: string;
	annotation: string;
	url: string;
	tags: string[];
	onSubmit: (id: string, name: string, annotation: string, url: string, tags: string[]) => void;

	constructor(app: App, id: string, name: string, annotation: string, url: string, tags: string[], onSubmit: (id: string, name: string, annotation: string, url: string, tags: string[]) => void) {
		super(app);
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

		// new Setting(contentEl)
		// 	.setName('Name')
		// 	.addText(text => text
		// 		.setValue(this.name)
		// 		.onChange(value => {
		// 			this.name = value;
		// 		})
		// 		.inputEl.style.width = '400px'
		// 	);

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
				.onClick(() => {
					// 构建数据对象
					const data = {
						id: this.id,
						// name: this.name,
						tags: this.tags,
						annotation: this.annotation,
						url: this.url,
					};

					// 设置请求选项
					const requestOptions: RequestInit = {
						method: 'POST',
						body: JSON.stringify(data),
						redirect: 'follow' as RequestRedirect
					};

					// 发送请求
					fetch("http://localhost:41595/api/item/update", requestOptions)
						.then(response => response.json())
						.then(result => {
							console.log(result);
							new Notice('Data uploaded successfully');
						})
						.catch(error => {
							console.log('error', error);
							new Notice('Failed to upload data');
						});

					// 调用 onSubmit 回调
					this.onSubmit(this.id, this.name, this.annotation, this.url, this.tags);
					this.close();
				}));
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// 创建放大图片的遮罩层
function createZoomMask(): HTMLDivElement {
	const mask = document.createElement('div');
	mask.id = 'af-mask';
	mask.style.position = 'fixed';
	mask.style.top = '0';
	mask.style.left = '0';
	mask.style.width = '100%';
	mask.style.height = '100%';
	mask.style.background = 'rgba(0, 0, 0, 0.5)';
	mask.style.zIndex = '9998';
	document.body.appendChild(mask);
	return mask;
}

// 创建放大图片
async function createZoomedImage(src: string, adaptive_ratio: number): Promise<{ zoomedImage: HTMLImageElement, originalWidth: number, originalHeight: number }> {
	const zoomedImage = document.createElement('img');
	zoomedImage.id = 'af-zoomed-image';
	zoomedImage.src = src;
	zoomedImage.style.position = 'fixed';
	zoomedImage.style.zIndex = '9999';
	zoomedImage.style.top = '50%';
	zoomedImage.style.left = '50%';
	zoomedImage.style.transform = 'translate(-50%, -50%)';
	document.body.appendChild(zoomedImage);

	let originalWidth = zoomedImage.naturalWidth;
	let originalHeight = zoomedImage.naturalHeight;

	adaptivelyDisplayImage(zoomedImage, originalWidth, originalHeight, adaptive_ratio);

	return {
		zoomedImage,
		originalWidth,
		originalHeight
	};
}

// 自适应图片大小
function adaptivelyDisplayImage(zoomedImage: HTMLImageElement, originalWidth: number, originalHeight: number, adaptive_ratio: number) {
	zoomedImage.style.left = `50%`;
	zoomedImage.style.top = `50%`;
	// 如果图片的尺寸大于屏幕尺寸，使其大小为屏幕尺寸的 adaptive_ratio
	let screenRatio = adaptive_ratio;   // 屏幕尺寸比例
	let screenWidth = window.innerWidth;
	let screenHeight = window.innerHeight;

	// Adjust initial size of the image if it exceeds screen size
	if (originalWidth > screenWidth || originalHeight > screenHeight) {
		if (originalWidth / screenWidth > originalHeight / screenHeight) {
			zoomedImage.style.width = `${screenWidth * screenRatio}px`;
			zoomedImage.style.height = 'auto';
		} else {
			zoomedImage.style.height = `${screenHeight * screenRatio}px`;
			zoomedImage.style.width = 'auto';
		}
	} else {
		zoomedImage.style.width = `${originalWidth}px`;
		zoomedImage.style.height = `${originalHeight}px`;
	}
}

// 创建百分比指示元素
function createZoomScaleDiv(zoomedImage: HTMLImageElement, originalWidth: number, originalHeight: number): HTMLDivElement {
	const scaleDiv = document.createElement('div');
	scaleDiv.id = 'af-scale-div';
	scaleDiv.classList.add('af-scale-div');
	scaleDiv.style.zIndex = '10000';
	updateZoomScaleDiv(scaleDiv, zoomedImage, originalWidth, originalHeight);
	document.body.appendChild(scaleDiv);
	return scaleDiv;
}
// 更新百分比指示元素
function updateZoomScaleDiv(scaleDiv: HTMLDivElement, zoomedImage: HTMLImageElement, originalWidth: number, originalHeight: number) {
	// 获取当前的宽度和高度
	const width = zoomedImage.offsetWidth;
	const height = zoomedImage.offsetHeight;
	let scalePercent = width / originalWidth * 100;
	scaleDiv.innerText = `${width}×${height} (${scalePercent.toFixed(1)}%)`;
}

// 滚轮事件处理器
function handleZoomMouseWheel(e: WheelEvent, zoomedImage: HTMLImageElement, originalWidth: number, originalHeight: number, scaleDiv: HTMLDivElement) {
	e.preventDefault();
	const mouseX = e.clientX;
	const mouseY = e.clientY;
	const scale = e.deltaY > 0 ? 0.95 : 1.05;
	const newWidth = scale * zoomedImage.offsetWidth;
	const newHeight = scale * zoomedImage.offsetHeight;
	const newLeft = mouseX - (mouseX - zoomedImage.offsetLeft) * scale;
	const newTop = mouseY - (mouseY - zoomedImage.offsetTop) * scale;
	zoomedImage.style.width = `${newWidth}px`;
	zoomedImage.style.height = `${newHeight}px`;
	zoomedImage.style.left = `${newLeft}px`;
	zoomedImage.style.top = `${newTop}px`;
	updateZoomScaleDiv(scaleDiv, zoomedImage, originalWidth, originalHeight);
}
// 鼠标右键点击事件处理器
function handleZoomContextMenu(e: MouseEvent, zoomedImage: HTMLImageElement, originalWidth: number, originalHeight: number, scaleDiv: HTMLDivElement) {
	e.preventDefault();
	zoomedImage.style.width = `${originalWidth}px`;
	zoomedImage.style.height = `${originalHeight}px`;
	zoomedImage.style.left = `50%`;
	zoomedImage.style.top = `50%`;
	updateZoomScaleDiv(scaleDiv, zoomedImage, originalWidth, originalHeight);
}

// 拖动事件处理器
function handleZoomDragStart(e: MouseEvent, zoomedImage: HTMLImageElement) {
	// 事件处理的代码 ...
	// 阻止浏览器默认的拖动事件
	e.preventDefault();

	// 记录点击位置
	let clickX = e.clientX;
	let clickY = e.clientY;

	// 更新元素位置的回调函数
	const updatePosition = (moveEvt: MouseEvent) => {
		// 计算鼠标移动距离
		let moveX = moveEvt.clientX - clickX;
		let moveY = moveEvt.clientY - clickY;

		// 定位图片位置
		zoomedImage.style.left = `${zoomedImage.offsetLeft + moveX}px`;
		zoomedImage.style.top = `${zoomedImage.offsetTop + moveY}px`;

		// 更新点击位置
		clickX = moveEvt.clientX;
		clickY = moveEvt.clientY;
	}

	// 鼠标移动事件
	document.addEventListener('mousemove', updatePosition);

	// 鼠标松开事件
	document.addEventListener('mouseup', function listener() {
		// 移除鼠标移动和鼠标松开的监听器
		document.removeEventListener('mousemove', updatePosition);
		document.removeEventListener('mouseup', listener);
	}, { once: true });
}

// 复制文件到剪贴板
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
		// 解决方案1: 会调出Finder，产生瞬间的窗口，但是该复制操作完全是系统级别的，没有任何限制
		execSync(`open -R "${filePath}"`);
        execSync(`osascript -e 'tell application "System Events" to keystroke "c" using command down'`);
        execSync(`osascript -e 'tell application "System Events" to keystroke "w" using command down'`);
		execSync(`open -a "Obsidian.app"`);

		// ----------------------------------------------
		// 测试切换输入法方案: 模拟Shift键按下，但是失败了
		// execSync(`osascript -e 'tell application "System Events" to key down shift'`);
		// execSync(`osascript -e 'delay 0.05'`);
		// execSync(`osascript -e 'tell application "System Events" to key up shift'`);
		// ----------------------------------------------

		// ----------------------------------------------
		// 另一种解决方案，不会调出Finder，但是复制的文件无法粘贴到word或者微信中
		// const appleScript = `
		// 	on run args
		// 		set the clipboard to POSIX file (first item of args)
		// 	end
		// 	`;
		// exec(`osascript -e '${appleScript}' "${filePath}"`, callback);
		// ----------------------------------------------
    } else if (process.platform === 'linux') {
		// 目前方案
		// xclip -selection clipboard -t $(file --mime-type -b /path/to/your/file) -i /path/to/your/file
        // exec(`xclip -selection c < ${filePath}`, callback);
		// exec(`xclip -selection clipboard -t $(file --mime-type -b "${filePath}") -i "${filePath}"`, callback);
    } else if (process.platform === 'win32') {
		// 当文件路径包含 '
		// 在PowerShell中，单引号字符串是直接的字符串，内部的单引号无法通过反斜线来转义，但是可以通过在单引号前再加一个单引号来进行转义。
		let safeFilePath = filePath.replace(/'/g, "''");
        exec(`powershell -command "Set-Clipboard -Path '${safeFilePath}'"`, callback);
    }
}
