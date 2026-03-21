//from  [AttachFlow](https://github.com/Yaozhuwa/AttachFlow)
import { App, MarkdownView } from 'obsidian';
import { EditorView } from '@codemirror/view';

const MARKDOWN_IMAGE_LINK_REGEX = /!\[[^\]]*\]\([^)]+\)/g;
const WIKILINK_IMAGE_REGEX = /!\[\[[^\]]+\]\]/g;

interface ImageReferenceRange {
	from: number;
	to: number;
	score: number;
}

export async function handleImageClick(app: App, evt: MouseEvent, adaptiveRatio: number) {
	const target = evt.target as HTMLElement;

	if (target.tagName !== 'IMG') {
		removeZoomedImage();
		return;
	}

	if (target.id === 'af-zoomed-image') {
		return;
	}

	const imageTarget = target as HTMLImageElement;
	const rect = imageTarget.getBoundingClientRect();
	const imageCenter = rect.left + rect.width / 2;

	if (evt.clientX <= imageCenter) {
		if (selectImageMarkdownSource(app, evt, imageTarget)) {
			evt.preventDefault();
			evt.stopPropagation();
			evt.stopImmediatePropagation();
		}
		return;
	}

	if (document.getElementById('af-zoomed-image')) {
		return;
	}

	evt.preventDefault();
	evt.stopPropagation();
	evt.stopImmediatePropagation();

	createZoomMask();
	const { zoomedImage, originalWidth, originalHeight } = await createZoomedImage(imageTarget.src, adaptiveRatio);
	const scaleDiv = createZoomScaleDiv(zoomedImage, originalWidth, originalHeight);

	zoomedImage.addEventListener('wheel', (e) => handleZoomMouseWheel(e, zoomedImage, originalWidth, originalHeight, scaleDiv));
	zoomedImage.addEventListener('contextmenu', (e) => handleZoomContextMenu(e, zoomedImage, originalWidth, originalHeight, scaleDiv));
	zoomedImage.addEventListener('mousedown', (e) => handleZoomDragStart(e, zoomedImage));
	zoomedImage.addEventListener('dblclick', () => {
		adaptivelyDisplayImage(zoomedImage, originalWidth, originalHeight, adaptiveRatio);
		updateZoomScaleDiv(scaleDiv, zoomedImage, originalWidth, originalHeight);
	});
}

export function removeZoomedImage() {
	const zoomedImage = document.getElementById('af-zoomed-image');
	if (zoomedImage) document.body.removeChild(zoomedImage);
	const scaleDiv = document.getElementById('af-scale-div');
	if (scaleDiv) document.body.removeChild(scaleDiv);
	const mask = document.getElementById('af-mask');
	if (mask) document.body.removeChild(mask);
}

function selectImageMarkdownSource(app: App, evt: MouseEvent, imageTarget: HTMLImageElement): boolean {
	const activeView = app.workspace.getActiveViewOfType(MarkdownView);
	if (!activeView || activeView.getMode() === 'preview') {
		return false;
	}

	const editor = activeView.editor;
	const editorView = (editor as MarkdownView['editor'] & { cm?: EditorView }).cm;
	if (!(editorView instanceof EditorView)) {
		return false;
	}

	const targetPos = editorView.posAtCoords({ x: evt.clientX, y: evt.clientY });
	if (typeof targetPos !== 'number') {
		return false;
	}

	const referenceRange = findClosestImageReferenceRange(editorView, targetPos, imageTarget.src);
	if (!referenceRange) {
		return false;
	}

	editor.setSelection(
		editor.offsetToPos(referenceRange.from),
		editor.offsetToPos(referenceRange.to),
	);
	editor.focus();
	return true;
}

function findClosestImageReferenceRange(editorView: EditorView, targetPos: number, imageSrc: string): ImageReferenceRange | null {
	const targetLine = editorView.state.doc.lineAt(targetPos);
	const relativePos = targetPos - targetLine.from;
	const exactLineMatch = collectImageReferenceRanges(targetLine.text, targetLine.from, relativePos, imageSrc);
	if (exactLineMatch.length > 0) {
		return exactLineMatch[0];
	}

	for (let distance = 1; distance <= 2; distance += 1) {
		const previousLineNumber = targetLine.number - distance;
		if (previousLineNumber >= 1) {
			const previousLine = editorView.state.doc.line(previousLineNumber);
			const previousMatches = collectImageReferenceRanges(
				previousLine.text,
				previousLine.from,
				previousLine.text.length,
				imageSrc,
			);
			if (previousMatches.length > 0) {
				return previousMatches[0];
			}
		}

		const nextLineNumber = targetLine.number + distance;
		if (nextLineNumber <= editorView.state.doc.lines) {
			const nextLine = editorView.state.doc.line(nextLineNumber);
			const nextMatches = collectImageReferenceRanges(nextLine.text, nextLine.from, 0, imageSrc);
			if (nextMatches.length > 0) {
				return nextMatches[0];
			}
		}
	}

	return null;
}

function collectImageReferenceRanges(
	lineText: string,
	lineStart: number,
	relativePos: number,
	imageSrc: string,
): ImageReferenceRange[] {
	const ranges: ImageReferenceRange[] = [];

	collectRegexRanges(MARKDOWN_IMAGE_LINK_REGEX, lineText, (match, from, to) => {
		const score = scoreReferenceRange(from, to, relativePos, match[0], imageSrc);
		ranges.push({ from: lineStart + from, to: lineStart + to, score });
	});

	collectRegexRanges(WIKILINK_IMAGE_REGEX, lineText, (match, from, to) => {
		const score = scoreReferenceRange(from, to, relativePos, match[0], imageSrc);
		ranges.push({ from: lineStart + from, to: lineStart + to, score });
	});

	return ranges.sort((left, right) => right.score - left.score || left.from - right.from);
}

function collectRegexRanges(
	regex: RegExp,
	lineText: string,
	onMatch: (match: RegExpExecArray, from: number, to: number) => void,
): void {
	regex.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(lineText)) !== null) {
		const from = match.index;
		const to = match.index + match[0].length;
		onMatch(match, from, to);
	}
	regex.lastIndex = 0;
}

function scoreReferenceRange(from: number, to: number, relativePos: number, rawReference: string, imageSrc: string): number {
	let score = 0;
	if (relativePos >= from && relativePos <= to) {
		score += 1000;
	}

	const midpoint = (from + to) / 2;
	score -= Math.abs(relativePos - midpoint);

	if (imageSrc && rawReference.includes(imageSrc)) {
		score += 500;
	}

	return score;
}

// ... existing functions like createZoomMask, createZoomedImage, adaptivelyDisplayImage, etc. ...
// 创建放大图片的遮罩层
function createZoomMask(): HTMLDivElement {
	const mask = document.createElement('div');
	mask.id = 'af-mask';
	mask.style.position = 'fixed';
	mask.style.top = '0';
	mask.style.left = '0';
	mask.style.width = '100%';
	mask.style.height = '100%';
	mask.style.background = 'rgba(0, 0, 0, 0.5)';
	mask.style.zIndex = '9998';
	document.body.appendChild(mask);
	return mask;
}

// 创建放大图片
async function createZoomedImage(src: string, adaptive_ratio: number): Promise<{ zoomedImage: HTMLImageElement, originalWidth: number, originalHeight: number }> {
	const zoomedImage = document.createElement('img');
	zoomedImage.id = 'af-zoomed-image';
	zoomedImage.src = src;
	zoomedImage.style.position = 'fixed';
	zoomedImage.style.zIndex = '9999';
	zoomedImage.style.top = '50%';
	zoomedImage.style.left = '50%';
	zoomedImage.style.transform = 'translate(-50%, -50%)';
	document.body.appendChild(zoomedImage);

	let originalWidth = zoomedImage.naturalWidth;
	let originalHeight = zoomedImage.naturalHeight;

	adaptivelyDisplayImage(zoomedImage, originalWidth, originalHeight, adaptive_ratio);

	return {
		zoomedImage,
		originalWidth,
		originalHeight
	};
}

// 自适应图片大小
function adaptivelyDisplayImage(zoomedImage: HTMLImageElement, originalWidth: number, originalHeight: number, adaptive_ratio: number) {
	zoomedImage.style.left = `50%`;
	zoomedImage.style.top = `50%`;
	let screenRatio = adaptive_ratio;
	let screenWidth = window.innerWidth;
	let screenHeight = window.innerHeight;

	if (originalWidth > screenWidth || originalHeight > screenHeight) {
		if (originalWidth / screenWidth > originalHeight / screenHeight) {
			zoomedImage.style.width = `${screenWidth * screenRatio}px`;
			zoomedImage.style.height = 'auto';
		} else {
			zoomedImage.style.height = `${screenHeight * screenRatio}px`;
			zoomedImage.style.width = 'auto';
		}
	} else {
		zoomedImage.style.width = `${originalWidth}px`;
		zoomedImage.style.height = `${originalHeight}px`;
	}
}

// 创建百分比指示元素
function createZoomScaleDiv(zoomedImage: HTMLImageElement, originalWidth: number, originalHeight: number): HTMLDivElement {
	const scaleDiv = document.createElement('div');
	scaleDiv.id = 'af-scale-div';
	scaleDiv.classList.add('af-scale-div');
	scaleDiv.style.zIndex = '10000';
	updateZoomScaleDiv(scaleDiv, zoomedImage, originalWidth, originalHeight);
	document.body.appendChild(scaleDiv);
	return scaleDiv;
}

// 更新百分比指示元素
function updateZoomScaleDiv(scaleDiv: HTMLDivElement, zoomedImage: HTMLImageElement, originalWidth: number, originalHeight: number) {
	const width = zoomedImage.offsetWidth;
	const height = zoomedImage.offsetHeight;
	let scalePercent = width / originalWidth * 100;
	scaleDiv.innerText = `${width}x${height} (${scalePercent.toFixed(1)}%)`;
}

// 滚轮事件处理器
function handleZoomMouseWheel(e: WheelEvent, zoomedImage: HTMLImageElement, originalWidth: number, originalHeight: number, scaleDiv: HTMLDivElement) {
	e.preventDefault();
	const mouseX = e.clientX;
	const mouseY = e.clientY;
	const scale = e.deltaY > 0 ? 0.95 : 1.05;
	const newWidth = scale * zoomedImage.offsetWidth;
	const newHeight = scale * zoomedImage.offsetHeight;
	const newLeft = mouseX - (mouseX - zoomedImage.offsetLeft) * scale;
	const newTop = mouseY - (mouseY - zoomedImage.offsetTop) * scale;
	zoomedImage.style.width = `${newWidth}px`;
	zoomedImage.style.height = `${newHeight}px`;
	zoomedImage.style.left = `${newLeft}px`;
	zoomedImage.style.top = `${newTop}px`;
	updateZoomScaleDiv(scaleDiv, zoomedImage, originalWidth, originalHeight);
}

// 鼠标右键点击事件处理器
function handleZoomContextMenu(e: MouseEvent, zoomedImage: HTMLImageElement, originalWidth: number, originalHeight: number, scaleDiv: HTMLDivElement) {
	e.preventDefault();
	zoomedImage.style.width = `${originalWidth}px`;
	zoomedImage.style.height = `${originalHeight}px`;
	zoomedImage.style.left = `50%`;
	zoomedImage.style.top = `50%`;
	updateZoomScaleDiv(scaleDiv, zoomedImage, originalWidth, originalHeight);
}

// 拖动事件处理器
function handleZoomDragStart(e: MouseEvent, zoomedImage: HTMLImageElement) {
	e.preventDefault();

	let clickX = e.clientX;
	let clickY = e.clientY;

	const updatePosition = (moveEvt: MouseEvent) => {
		let moveX = moveEvt.clientX - clickX;
		let moveY = moveEvt.clientY - clickY;

		zoomedImage.style.left = `${zoomedImage.offsetLeft + moveX}px`;
		zoomedImage.style.top = `${zoomedImage.offsetTop + moveY}px`;

		clickX = moveEvt.clientX;
		clickY = moveEvt.clientY;
	};

	document.addEventListener('mousemove', updatePosition);

	document.addEventListener('mouseup', function listener() {
		document.removeEventListener('mousemove', updatePosition);
		document.removeEventListener('mouseup', listener);
	}, { once: true });
}
