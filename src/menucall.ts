import { Menu, MenuItem, MarkdownView, Notice, Modal, App, Setting } from 'obsidian';
import MyPlugin from './main';
import * as path from 'path';
import { onElement } from './onElement';
import { print, setDebug } from './main';
import { exec, spawn, execSync } from 'child_process';
import { existsSync } from 'fs';

export function handleLinkClick(plugin: MyPlugin, event: MouseEvent, url: string) {
	const menu = new Menu();
	const inPreview = plugin.app.workspace.getActiveViewOfType(MarkdownView)?.getMode() == "preview";
	if (inPreview) {
		addEagleImageMenuPreviewMode(plugin, menu, url, event);
	} else {
		addEagleImageMenuSourceMode(plugin, menu, url, event);
	}
	registerEscapeButton(plugin, menu);
	let offset = 0;
	menu.showAtPosition({ x: event.pageX, y: event.pageY + offset });
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
	if (inPreview) {
		addEagleImageMenuPreviewMode(this, menu, url, event);
	} else {
		addEagleImageMenuSourceMode(this, menu, url, event);
	}
	registerEscapeButton(this, menu);
	let offset = 0;
	if (!inPreview && (inTable || inCallout)) offset = -138;
	menu.showAtPosition({ x: event.pageX, y: event.pageY + offset });
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

export async function addEagleImageMenuPreviewMode(plugin: MyPlugin, menu: Menu, oburl: string, event: MouseEvent) {
	const imageInfo = await fetchImageInfo(oburl);

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
                    const libraryPath = plugin.settings.libraryPath;
                    const localFilePath = path.join(
                        libraryPath,
                        "images",
                        `${id}.info`,
                        `${name}.${ext}`
                    );
        
                    // 打印路径用于调试
                    new Notice(`File real path: ${localFilePath}`);
                    // print(`文件的真实路径是: ${localFilePath}`);
        
                    // 使用 spawn 调用 explorer.exe 打开文件
                    const child = spawn('explorer.exe', [localFilePath], { shell: true });
                    child.on('error', (error) => {
                        print('Error opening file:', error);
                        new Notice('Cannot open the file, please check if the path is correct');
                    });

                    child.on('exit', (code) => {
                        if (code === 0) {
                            print('The file has been opened successfully');
                        } else {
                            print(`The file cannot be opened normally, exit code: ${code}`);
                        }
                    });
                })
        );
        menu.addItem((item: MenuItem) =>
            item
                .setIcon("external-link")
                .setTitle("Open in other apps")
                .onClick(() => {
                    const libraryPath = plugin.settings.libraryPath;
                    const localFilePath = path.join(
                        libraryPath,
                        "images",
                        `${id}.info`,
                        `${name}.${ext}`
                    );
        
                    // 打印路径用于调试
                    new Notice(`File real path: ${localFilePath}`);
                    // print(`文件的真实路径是: ${localFilePath}`);
        
                    // 使用 rundll32 调用系统的"打开方式"对话框
                    const child = spawn('rundll32', ['shell32.dll,OpenAs_RunDLL', localFilePath], { shell: true });

                    child.on('error', (error) => {
                        print('Error opening file:', error);
                        new Notice('Cannot open the file, please check if the path is correct');
                    });

                    child.on('exit', (code) => {
                        if (code === 0) {
                            print('The file has been opened successfully');
                        } else {
                            print(`The file cannot be opened normally, exit code: ${code}`);
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
                const libraryPath = plugin.settings.libraryPath;
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
                    new ModifyPropertiesModal(this.app, id, name, annotation, url, tagsArray, (newId, newName, newAnnotation, newUrl, newTags) => {
                        // new Notice(`Name changed to: ${newName}`);
                        // 在这里处理保存逻辑
                    }).open();
                })
        );
        // 其他菜单项可以继续使用 { id, name, ext } 数据
    }

	menu.showAtPosition({ x: event.pageX, y: event.pageY });
}

export async function addEagleImageMenuSourceMode(plugin: MyPlugin, menu: Menu, url: string, event: MouseEvent) {
	await addEagleImageMenuPreviewMode(plugin, menu, url, event);

    menu.addItem((item: MenuItem) =>
        item
            .setIcon("copy")
            .setTitle("Copy markdown link")
            .onClick(async () => {
                const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
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
                const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
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
                    const regex = new RegExp(`!?\\[.*?\\]\\(${url}\\)`, 'g');
                    const match = regex.exec(lineText);

                    if (match) {
                        const from = { line: line, ch: match.index };
                        const to = { line: line, ch: match.index + match[0].length };
                        doc.replaceRange('', from, to);
                        new Notice('Link deleted');
                        linkFound = true;
                        break; // 找到并删除后退出循环
                    }
                }

                if (!linkFound) {
                    new Notice('Cannot find the link');
                }
            })
    );
	menu.showAtPosition({ x: event.pageX, y: event.pageY });
} 

// 修改eagle属性中的annotation,url,tags
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
							print(result);
							new Notice('Data uploaded successfully');
						})
						.catch(error => {
							print('error', error);
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

export async function fetchImageInfo(url: string): Promise<{ id: string, name: string, ext: string, annotation: string, tags: string, url: string } | null> {
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
				print('Failed to fetch item info');
			}
		} catch (error) {
			print('Error fetching item info', error);
		}
	} else {
		print('Invalid image source format');
	}
	return null;
}