export async function handleImageClick(evt: MouseEvent, adaptiveRatio: number) {
	const target = evt.target as HTMLElement;

	if (target.tagName !== 'IMG') {
		removeZoomedImage();
		return;
	}

	const rect = target.getBoundingClientRect();
	const imageCenter = rect.left + rect.width / 2;

	if (evt.clientX <= imageCenter || document.getElementById('af-zoomed-image')) return;

	evt.preventDefault();

	const mask = createZoomMask();
	const { zoomedImage, originalWidth, originalHeight } = await createZoomedImage((target as HTMLImageElement).src, adaptiveRatio);
	const scaleDiv = createZoomScaleDiv(zoomedImage, originalWidth, originalHeight);

	zoomedImage.addEventListener('wheel', (e) => handleZoomMouseWheel(e, zoomedImage, originalWidth, originalHeight, scaleDiv));
	zoomedImage.addEventListener('contextmenu', (e) => handleZoomContextMenu(e, zoomedImage, originalWidth, originalHeight, scaleDiv));
	zoomedImage.addEventListener('mousedown', (e) => handleZoomDragStart(e, zoomedImage));
	zoomedImage.addEventListener('dblclick', (e) => {
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
	// 如果图片的尺寸大于屏幕尺寸，使其大小为屏幕尺寸的 adaptive_ratio
	let screenRatio = adaptive_ratio;   // 屏幕尺寸比例
	let screenWidth = window.innerWidth;
	let screenHeight = window.innerHeight;

	// Adjust initial size of the image if it exceeds screen size
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
	// 获取当前的宽度和高度
	const width = zoomedImage.offsetWidth;
	const height = zoomedImage.offsetHeight;
	let scalePercent = width / originalWidth * 100;
	scaleDiv.innerText = `${width}×${height} (${scalePercent.toFixed(1)}%)`;
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
	// 事件处理的代码 ...
	// 阻止浏览器默认的拖动事件
	e.preventDefault();

	// 记录点击位置
	let clickX = e.clientX;
	let clickY = e.clientY;

	// 更新元素位置的回调函数
	const updatePosition = (moveEvt: MouseEvent) => {
		// 计算鼠标移动距离
		let moveX = moveEvt.clientX - clickX;
		let moveY = moveEvt.clientY - clickY;

		// 定位图片位置
		zoomedImage.style.left = `${zoomedImage.offsetLeft + moveX}px`;
		zoomedImage.style.top = `${zoomedImage.offsetTop + moveY}px`;

		// 更新点击位置
		clickX = moveEvt.clientX;
		clickY = moveEvt.clientY;
	}

	// 鼠标移动事件
	document.addEventListener('mousemove', updatePosition);

	// 鼠标松开事件
	document.addEventListener('mouseup', function listener() {
		// 移除鼠标移动和鼠标松开的监听器
		document.removeEventListener('mousemove', updatePosition);
		document.removeEventListener('mouseup', listener);
	}, { once: true });
}