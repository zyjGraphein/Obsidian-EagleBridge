
export function onElement(
    el: Document,
    event: keyof HTMLElementEventMap,
    selector: string,
    listener: Listener,
    options?: { capture?: boolean; }
) {
    el.on(event, selector, listener, options);
    return () => el.off(event, selector, listener, options);
}

export interface Listener {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this: Document, ev: Event): any;
}

// 如果是 type 是 "img"，就准确删除图片引用链接的部分，如果是其他类型，直接删除整行
// target_line （1-based） 和 target_ch 是指示附件所在的位置
// export const deleteCurTargetLink = (
// 	file_base_name: string,
// 	plugin: AttachFlowPlugin,
// 	target_type: string,
// 	target_pos: number,
// 	in_table: boolean,
// 	in_callout: boolean
// ) => {
// 	file_base_name = file_base_name.startsWith('/') ? file_base_name.substring(1):file_base_name;
// 	const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView) as MarkdownView;
// 	const editor = activeView.editor;
// 	//  @ts-expect-error, not typed
// 	const editorView = editor.cm as EditorView;

// 	let target_line = editorView.state.doc.lineAt(target_pos);
// 	let line_text = target_line.text;

// 	if (!in_table && !in_callout){
// 		let finds = findLinkInLine(file_base_name, line_text);
// 		if (finds.length == 0){
// 			new Notice("Fail to find the link-text, please delete it manually!", 0);
// 			return;
// 		}
// 		else if(finds.length != 1){
// 			new Notice("Find multiple same Link in current line, please delete it manually!", 0);
// 			return;
// 		}
// 		else{
// 			// editorView.dispatch({changes: {from: target_line.from + finds[0][0], to: target_line.from + finds[0][1], insert: ''}});
// 			editor.replaceRange('', {line: target_line.number-1, ch: finds[0][0]}, {line: target_line.number-1, ch: finds[0][1]});
// 			return;
// 		}
// 	}

// 	type RegDictionary = {
// 		[key: string]: RegExp;
// 	};
	
// 	let startReg: RegDictionary = {
// 		'table': /^\s*\|/,
// 		'callout': /^>/,
// 	};

// 	let mode = in_table ? 'table' : 'callout';
// 	let finds_lines: number[] = [];
// 	let finds_all: [from:number, to:number][] = [];
// 	for (let i=target_line.number; i<=editor.lineCount(); i++){
// 		let line_text = editor.getLine(i-1);
// 		if (!startReg[mode].test(line_text)) break;
// 		print(`line_${i}_text:`, line_text)
// 		let finds = findLinkInLine(file_base_name, line_text);
// 		if (finds.length > 0){
// 			finds_lines.push(...new Array(finds.length).fill(i));
// 			finds_all.push(...finds);
// 		}
// 	}

// 	for (let i=target_line.number-1; i>=1; i--){
// 		let line_text = editor.getLine(i-1);
// 		if (!startReg[mode].test(line_text)) break;
// 		print(`line_${i}_text:`, line_text)
// 		let finds = findLinkInLine(file_base_name, line_text);
// 		if (finds.length > 0){
// 			finds_lines.push(...new Array(finds.length).fill(i));
// 			finds_all.push(...finds);
// 		}
// 	}

// 	if (finds_all.length == 0){
// 		new Notice(`Fail to find the link-text (for links in ${mode}), please delete it manually!`, 0);
// 		return;
// 	}
// 	else if(finds_all.length != 1){
// 		new Notice(`Find multiple same Link in current ${mode}, please delete it manually!`, 0);
// 		return;
// 	}
// 	else{
// 		editor.replaceRange('', {line: finds_lines[0]-1, ch: finds_all[0][0]}, {line: finds_lines[0]-1, ch: finds_all[0][1]});
// 	}

// 	editor.focus();
// }