import { syntaxTree } from "@codemirror/language";
import { Extension, RangeSetBuilder, StateField, Transaction } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";
import { EmbedWidget } from "./embed-widget";
import { isURL, isLocalHostLink, embedManager, isLinkToImage } from "./embed";

// 使用与参考代码完全一致的正则表达式
const formattingImageMarkerRegex = /formatting_formatting-image_image_image-marker(?:_list-\d*)?$/;
const stringUrlRegex = /^(?:list-\d*_)?string_url$/;

// 调试函数
function debugLog(message: string, ...args: any[]) {
    // console.log(`[Eagle-Embed-Debug] ${message}`, ...args); // 删除冗余
}

// 检查Alt文本是否表示图片类型（与embed.ts保持一致）
function isAltTextImage(alt: string): boolean {
    // 首先处理可能包含尺寸的情况，如 "image.png|700"
    const mainPart = alt.split('|')[0].trim();
    debugLog(`检查alt文本: ${alt}, 主要部分: ${mainPart}`);
    return /\.(jpg|jpeg|png|gif|webp|svg|avif|bmp|ico)$/i.test(mainPart);
}

// 定义编辑器状态字段
export const embedField = StateField.define<DecorationSet>({
    create(): DecorationSet {
        // print("创建初始装饰集");
        return Decoration.none;
    },
    
    update(oldState: DecorationSet, transaction: Transaction): DecorationSet {
        const builder = new RangeSetBuilder<Decoration>();
        
        // 检查是否在实时预览模式下
        if (!transaction.state.field(editorLivePreviewField, false)) {
            // print("不在实时预览模式，跳过");
            return builder.finish();
        }
        
        // print("处理编辑器状态更新");
        
        // 追踪alt文本的开始位置
        let altTextStartPos: number | null = null;
        
        // 遍历语法树查找图像链接
        syntaxTree(transaction.state).iterate({
            enter(node) {
                // 调试节点类型
                debugLog(`节点类型: ${node.type.name}`);
                
                // 查找图像标记
                if (formattingImageMarkerRegex.test(node.type.name)) {
                    altTextStartPos = node.to + 1;
                    // print(`找到图像标记，alt文本开始位置: ${altTextStartPos}`);
                }
                // 查找URL
                else if (stringUrlRegex.test(node.type.name)) {
                    if (altTextStartPos === null) {
                        // print("未找到对应的图像标记，跳过URL");
                        return;
                    }
                    
                    // 获取URL和alt文本
                    const url = transaction.state.sliceDoc(node.from, node.to);
                    const alt = transaction.state.sliceDoc(altTextStartPos, node.from - 2);
                    
                    // print(`提取的URL: ${url}`);
                    // print(`提取的alt文本: ${alt}`);
                    
                    // 重置alt文本开始位置
                    altTextStartPos = null;
                    
                    // 检查是否应该嵌入
                    if (!isURL(url)) {
                        // print(`不是有效URL: ${url}`);
                        return;
                    }
                    
                    // 检查alt文本是否表示图片类型
                    if (isAltTextImage(alt)) {
                        // print(`根据alt文本识别为图片，跳过: ${alt}`);
                        return;
                    }
                    
                    // 检查是否为本地链接且不是图片链接
                    if (!isLocalHostLink(url) || isLinkToImage(url)) {
                        // print(`不是本地链接或是图片链接: ${url}`);
                        return;
                    }
                    
                    if (!embedManager.shouldEmbed(url)) {
                        // print(`不应该嵌入此URL: ${url}`);
                        return;
                    }
                    
                    // print(`创建嵌入内容: ${url}`);
                    
                    // 添加替换装饰
                    const replaceFrom = node.to + 1;
                    builder.add(
                        replaceFrom,
                        replaceFrom,
                        Decoration.replace({
                            widget: new EmbedWidget(url, alt),
                            block: true
                        })
                    );
                }
            }
        });
        
        return builder.finish();
    },
    
    provide(field: StateField<DecorationSet>): Extension {
        return EditorView.decorations.from(field);
    }
});