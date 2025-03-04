import { WidgetType } from "@codemirror/view";
import { embedManager } from "./embed";

// 调试函数
function debugLog(message: string, ...args: any[]) {
    console.log(`[Eagle-Embed-Widget] ${message}`, ...args);
}

export class EmbedWidget extends WidgetType {
    private url: string;
    private alt: string;
    private container: HTMLElement | null = null;

    constructor(url: string, alt: string = "") {
        super();
        this.url = url;
        this.alt = alt;
        // print(`创建嵌入部件: ${url}`);
    }

    eq(other: EmbedWidget): boolean {
        return other.url === this.url && other.alt === this.alt;
    }

    toDOM(): HTMLElement {
        // print(`渲染嵌入部件: ${this.url}`);
        
        // 如果已经有容器，返回现有容器
        if (this.container) {
            return this.container;
        }
        
        this.container = document.createElement('div');
        this.container.className = "eagle-embed-container cm-embed-block";
        
        // 检查是否有noembed标记
        if (this.alt && /noembed/i.test(this.alt)) {
            // print(`跳过嵌入，发现noembed标记: ${this.url}`);
            this.container.classList.add("eagle-embed-placeholder");
            this.container.textContent = `已禁用嵌入 (noembed): ${this.url.substring(0, 50)}...`;
            return this.container;
        }
        
        try {
            if (embedManager.shouldEmbed(this.url)) {
                // print(`创建嵌入内容: ${this.url}`);
                const result = embedManager.create(this.url);
                this.container = result.containerEl;
                
                // 添加编辑模式特定样式
                this.container.classList.add("cm-embed-block");
                
                // 添加加载事件处理
                if (result.iframeEl) {
                    const iframe = result.iframeEl;
                    // 设置iframe事件处理
                    iframe.onerror = () => {
                        // print(`嵌入加载失败: ${this.url}`);
                        this.showError(`加载失败: ${this.url}`);
                    };
                    
                    iframe.onload = () => {
                        // print(`嵌入加载成功: ${this.url}`);
                    };
                }
            } else {
                // print(`不应该嵌入此URL: ${this.url}`);
                this.container.classList.add("eagle-embed-placeholder");
                this.container.textContent = `不支持的嵌入内容: ${this.url.substring(0, 50)}...`;
            }
        } catch (error) {
            // print(`处理嵌入时出错: ${error}`);
            this.showError(`处理嵌入时出错: ${error}`);
        }
        
        return this.container;
    }
    
    // 显示错误信息
    private showError(message: string): void {
        if (!this.container) return;
        
        this.container.innerHTML = '';
        this.container.classList.add("eagle-embed-error");
        this.container.textContent = message;
    }

    ignoreEvent(): boolean {
        return false;
    }
}