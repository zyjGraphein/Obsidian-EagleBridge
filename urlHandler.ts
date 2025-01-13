import { Editor , Notice} from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getLatestDirUrl, urlEmitter } from './server';
import MyPlugin from './main';

// 处理粘贴事件的函数
export async function handlePasteEvent(clipboard: ClipboardEvent, editor: Editor, port: number, pluginInstance: MyPlugin) {
    // 获取剪贴板中的纯文本内容
    let clipboardText = clipboard.clipboardData?.getData('text/plain');
    // 如果剪贴板中没有文本内容，则返回
    // if (!clipboardText) return;

    // 检查剪贴板内容
    if (!clipboardText) {
        // 如果没有文本，继续执行文件检测逻辑
        console.log('剪贴板中没有文本，继续检测文件...');
        if (clipboard.clipboardData?.files.length) {
            const files = clipboard.clipboardData.files;
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                // 阻止默认的粘贴行为
                clipboard.preventDefault();

                try {
                    await uploadByClipboard(file, pluginInstance);
                    new Notice('文件上传成功');

                    // 监听 URL 更新事件
                    urlEmitter.once('urlUpdated', (latestDirUrl: string) => {
                        if (file.type.startsWith('image/')) {
                            editor.replaceSelection(`![${file.name}](${latestDirUrl})`);
                            new Notice('Eagle链接已转换');
                        } else {
                            editor.replaceSelection(`[${file.type} + ${file.name}](${latestDirUrl})`);
                        }
                    });
                    return; // 确保在成功处理后退出函数

                } catch (error) {
                    new Notice('文件上传失败，检查Eagle是否已启动');
                }
            }
        }
    } else if (clipboardText && clipboardText.startsWith(pluginInstance.settings.libraryPath)) {
        // 检查剪贴板内容是否为文件路径
        // 使用正则表达式提取文件夹 ID 和文件名
        const match = clipboardText.match(/images\\([^\\]+)\.info\\([^\\]+)\.(\w+)$/);
        if (match && match[1] && match[2] && match[3]) {
            const fileId = match[1];
            const fileName = match[2];
            const fileExt = match[3].toLowerCase();

            // 根据文件扩展名决定格式
            let updatedText;
            if (fileExt === 'png' || fileExt === 'jpg' || fileExt === 'jpeg') {
                clipboard.preventDefault();
                updatedText = `![${fileName}](http://localhost:${port}/images/${fileId}.info)`;
            } else {
                clipboard.preventDefault();
                updatedText = `[${fileName}](http://localhost:${port}/images/${fileId}.info)`;
            }
            editor.replaceSelection(updatedText);
            new Notice('Eagle链接已转换');
        } else {
            new Notice('非Eagle链接');
        }
        return;
    } else if (/^https?:\/\/[^\s]+$/.test(clipboardText) && !clipboardText.startsWith('http://localhost')) {
        clipboard.preventDefault();
        try {
            // 确保 clipboardText 是字符串
            const url = `${clipboardText}`;
            await uploadByUrl(url, pluginInstance, editor);
            new Notice('网址上传成功');
        } catch (error) {
            new Notice('网址上传失败');
        }
        console.log('剪贴板中有文本:', clipboardText);
        // ... 处理文本的逻辑 ...
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

// 使用API上传剪贴板中的图片
async function uploadByClipboard(file: File, pluginInstance: MyPlugin): Promise<void> {
    // 从插件实例的 settings 中获取 folderId
    const folderId = pluginInstance.settings.folderId || "";

    const tempDir = path.join(os.tmpdir(), 'obsidian-uploads');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir);
    }

    // 将文件保存到临时目录
    const filePath = path.join(tempDir, file.name);
    // console.log('File path:', filePath); // 在控制台打印文件路径
    const buffer = await file.arrayBuffer();
    fs.writeFileSync(filePath, Buffer.from(buffer));

    // 构建请求数据
    const data = {
        "path": filePath, // 使用文件的本地路径
        "name": file.name,
        // "id":"M52OQMHX2A85A",
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
        urlEmitter.once('urlUpdated', (latestDirUrl: string) => {
            editor.replaceSelection(`[](${latestDirUrl})`);
        });
    } catch (error) {
        console.error('Fetch error:', error);
        throw error;
    }
}


// 添加拖动事件处理
export async function handleDropEvent(event: DragEvent, editor: Editor, port: number, pluginInstance: MyPlugin) {
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            // 处理文件上传
            try {
                await uploadByClipboard(file, pluginInstance);
                new Notice('文件上传成功');

                // 监听 URL 更新事件
                urlEmitter.once('urlUpdated', (latestDirUrl: string) => {
                    if (file.type.startsWith('image/')) {
                        editor.replaceSelection(`![${file.name}](${latestDirUrl})`);
                        new Notice('Eagle链接已转换');
                    } else {
                        editor.replaceSelection(`[${file.type} + ${file.name}](${latestDirUrl})`);
                    }
                });
            } catch (error) {
                new Notice('文件上传失败，检查Eagle是否已启动');
            }
        }
    }
} 