// URL 检测函数
export function isURL(str: string): boolean {
    let url: URL;

    try {
        url = new URL(str);
    } catch {
        return false;
    }
    
    return url.protocol === "http:" || url.protocol === "https:";
}


// 检查是否为本地主机链接
export function isLocalHostLink(str: string): boolean {
    try {
        const url = new URL(str);
        return url.hostname === "localhost" || url.hostname === "127.0.0.1";
    } catch {
        return false;
    }
}


// 检查Alt文本是否表示图片类型（增强版）
export function isAltTextImage(alt: string): boolean {
    // 首先处理可能包含尺寸的情况，如 "image.png|700"
    const mainPart = alt.split('|')[0].trim();
    return /\.(jpg|jpeg|png|gif|webp|svg|avif|bmp|ico)$/i.test(mainPart);
}

// 基本嵌入数据结构
export interface EmbedResult {
    containerEl: HTMLElement;
    iframeEl?: HTMLIFrameElement;
}

// 本地链接嵌入处理器
export class LocalHostEmbedder {
    // 创建嵌入内容
    create(src: string): EmbedResult {
        const container = document.createElement('div');
        container.className = "eagle-embed-container";
        
        // 创建 iframe 元素
        const iframe = document.createElement('iframe');
        iframe.src = src;
        iframe.width = "100%";
        iframe.height = "500px"; // 增加高度以适应更多内容
        iframe.style.border = "none";
        iframe.setAttribute("allowfullscreen", "true");
        iframe.setAttribute("loading", "lazy");
        
        container.appendChild(iframe);
        
        return { 
            containerEl: container,
            iframeEl: iframe
        };
    }

    // 检查是否应该嵌入此链接
    shouldEmbed(src: string, alt?: string): boolean {
        // 如果提供了alt文本且表示图片，跳过嵌入
        if (alt && isAltTextImage(alt)) {
            console.log(`[Eagle-Embed] 跳过图片嵌入: ${alt}, URL: ${src}`);
            return false;
        }
        
        // 确认是localhost链接
        return isLocalHostLink(src);
    }
}

// 嵌入管理器
export const embedManager = new LocalHostEmbedder();
