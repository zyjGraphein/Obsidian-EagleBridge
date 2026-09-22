import { EditorView, WidgetType } from "@codemirror/view";
import { embedManager, EmbedResult } from "./embed";
import { setIcon, setTooltip } from "obsidian";

const embeds = new WeakMap<HTMLElement, EmbedResult>();

export class EmbedWidget extends WidgetType {
    constructor(private url: string, private alt: string, private sourceLength: number,
        private onEdit: (view: EditorView, range: { from: number; to: number }) => void) {
        super();
    }

    eq(other: EmbedWidget): boolean {
        return other.url === this.url && other.alt === this.alt && other.sourceLength === this.sourceLength;
    }

    toDOM(view: EditorView): HTMLElement {
        const result = embedManager.create(this.url, this.alt, view.dom.ownerDocument, () => view.requestMeasure());
        result.containerEl.classList.add('eagle-embed-block');
        const button = result.containerEl.createEl('button', { cls: 'eagle-embed-edit clickable-icon', type: 'button' });
        setIcon(button, 'code-2');
        setTooltip(button, 'Edit link');
        button.addEventListener('mousedown', event => event.preventDefault());
        button.addEventListener('click', event => {
            event.stopPropagation();
            const from = view.posAtDOM(result.containerEl);
            this.onEdit(view, { from, to: from + this.sourceLength });
        });
        embeds.set(result.containerEl, result);
        return result.containerEl;
    }

    destroy(dom: HTMLElement): void {
        embeds.get(dom)?.destroy();
        embeds.delete(dom);
    }

    ignoreEvent(): boolean {
        return true;
    }
}
