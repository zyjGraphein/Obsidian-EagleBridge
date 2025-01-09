import { Editor , Notice} from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getLatestDirUrl, urlEmitter } from './server';

// 处理粘贴事件的函数
export async function handlePasteEvent(clipboard: ClipboardEvent, editor: Editor, port: number) {
    // 获取剪贴板中的纯文本内容
    let clipboardText = clipboard.clipboardData?.getData('text/plain');
    // 如果剪贴板中没有文本内容，则返回
    // if (!clipboardText) return;

    // 检查剪贴板内容
    if (!clipboardText) {
        // 如果没有文本，继续执行图片检测逻辑
        console.log('剪贴板中没有文本，继续检测图片...');
        if (clipboard.clipboardData?.files.length) {
            const files = clipboard.clipboardData.files;
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                if (file.type.startsWith('image/')) {
                    // 阻止默认的粘贴行为
                    clipboard.preventDefault();

                    try {
                        await uploadByClipboard(file);
                        new Notice('图片上传成功');

                        // 监听 URL 更新事件
                        urlEmitter.once('urlUpdated', (latestDirUrl: string) => {
                            editor.replaceSelection(`![](${latestDirUrl})`);
                        });
                        new Notice('Eagle链接已转换');
                        return; // 确保在成功处理后退出函数

                    } catch (error) {
                        new Notice('图片上传失败');
                    }
                }
            }
        }
    } else {
        // 如果有文本，执行相关逻辑
            // 检查剪贴板内容是否为Eagle链接
            if (/eagle:\/\/item\/(\w+)/.test(clipboardText)) {
                // 阻止默认的粘贴行为
                clipboard.preventDefault();
                // 将Eagle链接转换为本地服务器的图片链接
                const updatedText = clipboardText.replace(/eagle:\/\/item\/(\w+)/g, (match, p1) => {
                    return `![](http://localhost:${port}/images/${p1}.info)`;
                });
                // 将转换后的文本插入到编辑器中
                editor.replaceSelection(updatedText);

                // 显示通知，告知用户Eagle链接已转换
                new Notice('Eagle链接已转换');
            }
        console.log('剪贴板中有文本:', clipboardText);
        // ... 处理文本的逻辑 ...
    }
}

// 使用API上传剪贴板中的图片
async function uploadByClipboard(file: File): Promise<void> {
    // 创建临时目录
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
        "name": "测试",
        // "id":"M52OQMHX2A85A",
        "token": "58f7ecda-250f-4043-8ae0-cd11d673f680" // 请替换为实际的API令牌
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