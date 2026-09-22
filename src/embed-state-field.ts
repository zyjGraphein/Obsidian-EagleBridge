import { syntaxTree } from "@codemirror/language";
import { EditorState, Prec, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";
import { EmbedWidget } from "./embed-widget";
import { embedManager } from "./embed";

const formattingImageMarkerRegex = /formatting_formatting-image_image_image-marker(?:_list-\d*)?$/;
const stringUrlRegex = /^(?:list-\d*_)?string_url$/;

interface EmbedRange { from: number; to: number }
const editEmbed = StateEffect.define<EmbedRange>();
export const editingEmbedField = StateField.define<EmbedRange | null>({
    create: () => null,
    update(range, transaction) {
        for (const effect of transaction.effects) {
            if (effect.is(editEmbed)) return effect.value;
        }
        if (!range) return null;
        const mapped = {
            from: transaction.changes.mapPos(range.from, -1),
            to: transaction.changes.mapPos(range.to, 1),
        };
        return transaction.state.selection.ranges.some(selection => selection.from <= mapped.to && selection.to >= mapped.from)
            ? mapped : null;
    },
});

function revealEmbedSource(view: EditorView, range: EmbedRange): void {
    view.dispatch({ effects: editEmbed.of(range), selection: { anchor: range.from, head: range.to } });
    // Let Obsidian expose its native source editor, including image selection state.
    const nativeEmbed = Array.from(view.dom.querySelectorAll<HTMLElement>('.image-embed')).find(element =>
        view.posAtDOM(element) === range.from);
    nativeEmbed?.querySelector<HTMLButtonElement>('.edit-block-button')?.click();
    view.focus();
}

function buildEmbeds(state: EditorState): DecorationSet {
    if (!state.field(editorLivePreviewField, false)) return Decoration.none;
    const builder = new RangeSetBuilder<Decoration>();
    const editing = state.field(editingEmbedField);
    let imageStart: number | null = null;
    let altStart = 0;
    syntaxTree(state).iterate({
        enter(node) {
            if (formattingImageMarkerRegex.test(node.type.name)) {
                imageStart = node.from;
                altStart = node.to + 1;
            } else if (stringUrlRegex.test(node.type.name) && imageStart !== null) {
                const from = imageStart;
                imageStart = null;
                const url = state.sliceDoc(node.from, node.to);
                const alt = state.sliceDoc(altStart, node.from - 2);
                if (!embedManager.shouldEmbed(url, alt)) return;
                if (editing && from <= editing.to && node.to + 1 >= editing.from) return;
                // Replace the whole embed, including Obsidian's image placeholder/actions.
                builder.add(from, node.to + 1, Decoration.replace({
                    widget: new EmbedWidget(url, alt, node.to + 1 - from, revealEmbedSource), block: true, inclusive: false,
                }));
            }
        },
    });
    return builder.finish();
}

export const embedField = StateField.define<DecorationSet>({
    create: buildEmbeds,
    update: (_, transaction) => buildEmbeds(transaction.state),
    provide: field => [
        Prec.highest(EditorView.decorations.from(field)),
        EditorView.atomicRanges.of(view => view.state.field(field)),
    ],
});
