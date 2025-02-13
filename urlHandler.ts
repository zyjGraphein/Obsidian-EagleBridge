import { Editor , Notice , FileSystemAdapter} from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getLatestDirUrl, urlEmitter } from './server';
import MyPlugin from './main';
const electron = require('electron')
const clipboard = electron.clipboard;
// import { clipboard } from 'electron';
// const { remote } = require('electron');  
// declare const app: any; // 声明全局 app 变量

// 处理粘贴事件的函数
export async function handlePasteEvent(clipboardEvent: ClipboardEvent, editor: Editor, port: number, pluginInstance: MyPlugin) {
    // 获取剪贴板中的纯文本内容
    let clipboardText = clipboardEvent.clipboardData?.getData('text/plain');
    let filePath = "";
    const os = process.platform;

    if (clipboardEvent.clipboardData?.files.length) {
        const file = clipboardEvent.clipboardData.files[0];
        filePath = electron.webUtils.getPathForFile(file);
    }
    
    if (clipboardText && /^https?:\/\/[^\s]+$/.test(clipboardText) && !clipboardText.startsWith('http://localhost')) {
        // 如果文本内容为 URL 且不以 http://localhost 开头
        clipboardEvent.preventDefault();
        try {
            const url = `${clipboardText}`;
            await uploadByUrl(url, pluginInstance, editor);
            new Notice('网址上传成功，请等待Eagle链接更新');
        } catch (error) {
            new Notice('网址上传失败');
        }
        console.log('剪贴板中有文本:', clipboardText);
    } else if (filePath) {
        // 如果 filePath 存在
        clipboardEvent.preventDefault();
        if (!filePath.startsWith(pluginInstance.settings.libraryPath)) {
            // 如果 filePath 不属于 pluginInstance.settings.libraryPath 的子文件
            try {
                await uploadByClipboard(filePath, pluginInstance);
                new Notice('文件上传成功');

                // 监听 URL 更新事件
                urlEmitter.once('urlUpdated', (latestDirUrl: string) => {
                    const fileName = path.basename(filePath);
                    const fileExt = path.extname(filePath).toLowerCase();

                    if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(fileExt)) {
                        editor.replaceSelection(`![${fileName}](${latestDirUrl})`);
                        new Notice('Eagle链接已转换');
                    } else {
                        editor.replaceSelection(`[${fileName}](${latestDirUrl})`);
                    }
                });
            } catch (error) {
                new Notice('文件上传失败，检查Eagle是否已启动');
            }
        } else {
            // 检查 filePath 中是否包含 'images\xxxxxx.info' 模式
            const match = filePath.match(/images\\[^\\]+\.info/);
            if (match) {
                const fileName = path.basename(filePath);
                const fileExt = path.extname(filePath).toLowerCase();

                let updatedText;
                const urlPath = match[0].replace(/\\/g, '/'); // 将反斜杠替换为正斜杠

                if (['.png', '.jpg', '.jpeg'].includes(fileExt)) {
                    clipboardEvent.preventDefault();
                    updatedText = `![${fileName}](http://localhost:${port}/${urlPath})`;
                } else {
                    clipboardEvent.preventDefault();
                    updatedText = `[${fileName}](http://localhost:${port}/${urlPath})`;
                }
                editor.replaceSelection(updatedText);
                new Notice('Eagle链接已转换');
            } else {
                new Notice('非Eagle链接');
            }
        }
    }
}
        // 检查剪贴板内容是否为Eagle链接
        // if (/eagle:\/\/item\/(\w+)/.test(clipboardText)) {
        //     clipboard.preventDefault();
        //     const updatedText = clipboardText.replace(/eagle:\/\/item\/(\w+)/g, (match, p1) => {
        //         return `![](http://localhost:${port}/images/${p1}.info)`;
        //     });
        //     editor.replaceSelection(updatedText);
        //     new Notice('Eagle链接已转换');
        // }
        // 如果是非局域网的URL
        
        // 获取剪贴板内容
        // else if (os === "win32") {
        //     const rawFilePath = clipboard.readBuffer("FileNameW");
        //     filePath = rawFilePath.toString('ucs2').replace(new RegExp(String.fromCharCode(0), "g"), "");
        // } else if (os === "darwin") {
        //     filePath = clipboard.read("public.file-url").replace("file://", "");
        // } else {
        //     filePath = ""; // Linux 或其他系统的处理
        // }
        // 检查剪贴板内容
        
// 使用API上传剪贴板中的图片
async function uploadByClipboard(filePath: string, pluginInstance: MyPlugin): Promise<void> {
    // 从插件实例的 settings 中获取 folderId
    const folderId = pluginInstance.settings.folderId || "";

    // 构建请求数据
    const data = {
        "path": filePath, // 直接使用传入的文件路径
        "name": path.basename(filePath), // 从路径中提取文件名
        "folderId": folderId,
        // "token": "58f7ecda-250f-4043-8ae0-cd11d673f680" // 请替换为实际的API令牌
    };

    // 构建请求选项
    const requestOptions = {
        method: 'POST',
        body: JSON.stringify(data),
        redirect: 'follow' as RequestRedirect
    };

    // 发送请求到指定的API端点
    const response = await fetch("http://localhost:41595/api/item/addFromPath", requestOptions);

    if (!response.ok) {
        throw new Error('上传失败');
    }

    // 不需要处理返回值，直接返回
    return; // 或者 return null; 如果需要返回一个值
}


async function uploadByUrl(url: string, pluginInstance: MyPlugin, editor: Editor): Promise<void> {
    const folderId = pluginInstance.settings.folderId || "";
    const data = {
        "url": url,
        // "name": "アルトリア･キャスター",
        // "tags": ["FGO", "アルトリア・キャスター"],
        "folderId": folderId
    };

    console.log('Request data:', data); // 调试输出请求数据

    const requestOptions = {
        method: 'POST',
        body: JSON.stringify(data),
        redirect: 'follow' as RequestRedirect
    };

    try {
        const response = await fetch("http://localhost:41595/api/item/addBookmark", requestOptions);

        if (!response.ok) {
            const errorResult = await response.json();
            console.error('Error response:', errorResult); // 输出错误响应
            throw new Error('上传失败');
        }

        // 添加延时等待
        // await new Promise(resolve => setTimeout(resolve, 2000)); // 延时2秒

        // 监听 URL 更新事件
        urlEmitter.once('urlUpdated', async (latestDirUrl: string) => {
            // 提取 ID
            console.log('latestDirUrl:', latestDirUrl);
            const match = latestDirUrl.match(/images\/([^/]+)\.info/);
            if (match && match[1]) {
                const fileId = match[1];

                // 设置请求选项
                const requestOptions = {
                    method: 'GET',
                    redirect: 'follow' as RequestRedirect 
                };

                try {
                    // 发送请求以获取文件信息
                    const response = await fetch(`http://localhost:41595/api/item/info?id=${fileId}`, requestOptions);
                    const result = await response.json();

                    if (result.status === "success" && result.data) {
                        const fileName = result.data.name;

                        // 更新编辑器中的链接
                        editor.replaceSelection(`[${fileName}](${latestDirUrl})`);
                    } else {
                        console.log('获取文件信息失败:', result);
                    }
                } catch (error) {
                    console.log('请求错误:', error);
                }
            } else {
                console.log('无法提取文件ID');
            }
        });
    } catch (error) {
        console.error('Fetch error:', error);
        throw error;
    }
}





// export async function handleDropEvent(dropEvent: DragEvent, editor: Editor, port: number, pluginInstance: MyPlugin) {
//     dropEvent.preventDefault();

//     // 在代码中添加详细日志
//     console.log('原始拖拽数据:', {
//         types: dropEvent.dataTransfer?.types,
//         files: dropEvent.dataTransfer?.files,
//         items: Array.from(dropEvent.dataTransfer?.items || []).map(i => ({
//             kind: i.kind,
//             type: i.type,
//             getAsFile: i.getAsFile()
//         }))

//     });

//     // 获取系统平台信息
//     const os = process.platform;
//     const filePaths: string[] = [];
    

//     // 遍历拖拽项
//     if (dropEvent.dataTransfer?.items) {
//         const items = Array.from(dropEvent.dataTransfer.items); // 将 items 转换为数组
//         for (const item of items) {
//             if (item.kind === 'file') {
//                 // 系统级路径获取逻辑
//                 let filePath = "";

//                 // Windows 系统处理
//                 if (os === "win32") {
//                     try {
//                         // 通过私有 API 获取 NTFS 路径
//                         const file = item.getAsFile() as any;
//                         if (file?.path) {
//                             filePath = file.path.replace(/\\/g, '/');
//                         }
//                     } catch (error) {
//                         console.error('Windows路径获取失败:', error);
//                     }
//                 }
//                 // macOS 系统处理
//                 else if (os === "darwin") {
//                     try {
//                         // 通过私有数据格式获取路径
//                         const uri = dropEvent.dataTransfer.getData('text/uri-list');
//                         if (uri) {
//                             filePath = decodeURIComponent(uri)
//                                 .replace('file://', '')
//                                 .replace(/\/([^/]+)$/, '$1'); // 安全解码
//                         }
//                     } catch (error) {
//                         console.error('macOS路径获取失败:', error);
//                     }
//                 }

//                 // 备用方案：使用传统方式获取
//                 if (!filePath) {
//                     const file = item.getAsFile();
//                     if (file) {
//                         filePath = (file as any).path || `/${file.name}`;
//                     }
//                 }

//                 if (filePath) {
//                     filePaths.push(filePath);
//                 }
//             }
//         }
//     }

//     // 处理所有获取到的文件路径
//     if (filePaths.length > 0) {
//         for (const filePath of filePaths) {
//             console.log('解析后的完整路径:', filePath);

//             try {
//                 const file = new File([], filePath); // 创建一个空的 File 对象
//                 await uploadByClipboard(file, pluginInstance);
//                 new Notice('文件上传成功');

//                 urlEmitter.once('urlUpdated', (latestDirUrl: string) => {
//                     const extension = filePath.split('.').pop()?.toLowerCase() || '';
//                     const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension);
                    
//                     const fileName = filePath.split('/').pop() || filePath;
//                     if (isImage) {
//                         editor.replaceSelection(`![${fileName}](${latestDirUrl})`);
//                     } else {
//                         editor.replaceSelection(`[${fileName}](${latestDirUrl})`);
//                     }
//                     new Notice('链接已插入');
//                 });
//             } catch (error) {
//                 console.error('上传失败:', error);
//                 new Notice(`上传失败: ${error.message}`);
//             }
//         }
//     }
// }

// // 新增工具函数
// function getFilePath(file: File): string {
//     // 类型安全的路径获取方式
//     const anyFile = file as any;
//     return anyFile.path || 
//            anyFile.filepath ||  // 某些环境下可能使用不同属性名
//            (anyFile.name && `/${anyFile.name}`) || // 备用方案
//            'unknown_path';
// }

// function getFileExtension(path: string): string {
//     return path.split('.').pop() || '';
// }


// 添加拖动事件处理
export async function handleDropEvent(dropEvent: DragEvent, editor: Editor, port: number, pluginInstance: MyPlugin) {
    dropEvent.preventDefault();

    // 检查拖拽事件中的文件
    if (dropEvent.dataTransfer?.files.length) {
        const files = dropEvent.dataTransfer.files;
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            // 使用 electron.webUtils.getPathForFile 获取文件路径
            const filePath = electron.webUtils.getPathForFile(file);

            console.log('拖拽文件路径:', filePath);

            if (!filePath.startsWith(pluginInstance.settings.libraryPath)) {
                // 如果 filePath 不属于 pluginInstance.settings.libraryPath 的子文件
                try {
                    await uploadByClipboard(filePath, pluginInstance);
                    new Notice('文件上传成功');

                    // 监听 URL 更新事件
                    urlEmitter.once('urlUpdated', (latestDirUrl: string) => {
                        const fileName = path.basename(filePath);
                        const fileExt = path.extname(filePath).toLowerCase();

                        if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(fileExt)) {
                            editor.replaceSelection(`![${fileName}](${latestDirUrl})`);
                            new Notice('Eagle链接已转换');
                        } else {
                            editor.replaceSelection(`[${fileName}](${latestDirUrl})`);
                        }
                    });
                } catch (error) {
                    new Notice('文件上传失败，检查Eagle是否已启动');
                }
            } else {
                // 检查 filePath 中是否包含 'images\xxxxxx.info' 模式
                const match = filePath.match(/images\\[^\\]+\.info/);
                if (match) {
                    const fileName = path.basename(filePath);
                    const fileExt = path.extname(filePath).toLowerCase();

                    let updatedText;
                    const urlPath = match[0].replace(/\\/g, '/'); // 将反斜杠替换为正斜杠

                    if (['.png', '.jpg', '.jpeg'].includes(fileExt)) {
                        updatedText = `![${fileName}](http://localhost:${port}/${urlPath})`;
                    } else {
                        updatedText = `[${fileName}](http://localhost:${port}/${urlPath})`;
                    }
                    editor.replaceSelection(updatedText);
                    new Notice('Eagle链接已转换');
                } else {
                    new Notice('非Eagle链接');
                }
            }
        }
    }
} 