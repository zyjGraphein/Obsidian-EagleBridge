import { Notice, TFile } from 'obsidian';
import type { AllCanvasNodeData, CanvasData, CanvasLinkData } from 'obsidian/canvas';
import MyPlugin, { print } from './main';
import {
    getTransferFiles,
    getTransferFilePath,
    type ResolvedEagleLink,
    resolveFilePathToEagleLink,
    resolveUrlToEagleLink,
    shouldUploadExternalUrl,
    shouldUploadTransferFiles,
} from './urlHandler';

const DEFAULT_LINK_WIDTH = 420;
const DEFAULT_LINK_HEIGHT = 280;
const MIN_IMAGE_NODE_WIDTH = 280;
const MAX_IMAGE_NODE_WIDTH = 1200;
const MIN_IMAGE_NODE_HEIGHT = 120;
const CANVAS_NODE_GAP = 48;
const EAGLE_ITEM_URL_REGEX = /^http:\/\/localhost:\d+\/images\/[^/]+\.info$/i;
const EAGLE_IMAGE_URL_REGEX = /^http:\/\/localhost:\d+\/images\/[^/]+\.info$/i;
const EAGLE_CANVAS_EMBED_URL_REGEX = /^http:\/\/localhost:\d+\/__eaglebridge__\/canvas-image\?/i;
const normalizingCanvasFiles = new Set<string>();
const scheduledNormalizeTimers = new Map<string, number>();
const activeNormalizeBursts = new Set<string>();

type ManagedCanvasLinkNode = CanvasLinkData & {
    eagleBridgeAspect?: number;
    eagleBridgeManaged?: boolean;
    eagleBridgeSourceUrl?: string;
    eagleBridgeLastWidth?: number;
    eagleBridgeLastHeight?: number;
};

interface CanvasContext {
    file: TFile;
    view: {
        containerEl?: HTMLElement;
        getViewType?: () => string;
    };
}

interface CanvasContextOptions {
    requireTargetInView?: boolean;
}

function consumeHandledEvent(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
}

export function registerCanvasDocument(plugin: MyPlugin, doc: Document) {
    plugin.registerDomEvent(doc, 'paste', (event: ClipboardEvent) => {
        void handleCanvasPaste(event, plugin);
    }, { capture: true });

    plugin.registerDomEvent(doc, 'drop', (event: DragEvent) => {
        void handleCanvasDrop(event, plugin);
    }, { capture: true });

    plugin.registerDomEvent(doc, 'pointerup', (event: PointerEvent) => {
        const context = getActiveCanvasContext(plugin, event);
        if (!context) {
            return;
        }
        queueNormalizeCanvasBurst(plugin, context.file);
        scheduleNormalizeCanvasFile(plugin, context.file, 120);
    }, { capture: true });
}

export function registerCanvasAutoNormalize(plugin: MyPlugin) {
    plugin.registerEvent(
        plugin.app.vault.on('modify', (file) => {
            if (!(file instanceof TFile) || file.extension !== 'canvas') {
                return;
            }
            scheduleNormalizeCanvasFile(plugin, file, 10);
        }),
    );

    plugin.registerEvent(
        plugin.app.workspace.on('file-open', (file) => {
            if (!(file instanceof TFile) || file.extension !== 'canvas') {
                return;
            }
            scheduleNormalizeCanvasFile(plugin, file, 0);
        }),
    );
}

function scheduleNormalizeCanvasFile(plugin: MyPlugin, file: TFile, delayMs: number): void {
    const existingTimer = scheduledNormalizeTimers.get(file.path);
    if (existingTimer) {
        window.clearTimeout(existingTimer);
    }

    const nextTimer = window.setTimeout(() => {
        scheduledNormalizeTimers.delete(file.path);
        void normalizeCanvasFile(plugin, file);
    }, delayMs);

    scheduledNormalizeTimers.set(file.path, nextTimer);
}

function queueNormalizeCanvasBurst(plugin: MyPlugin, file: TFile): void {
    if (activeNormalizeBursts.has(file.path)) {
        return;
    }

    activeNormalizeBursts.add(file.path);
    void (async () => {
        try {
            for (const delayMs of [80, 220, 500, 900]) {
                await new Promise((resolve) => window.setTimeout(resolve, delayMs));
                if (await normalizeCanvasFile(plugin, file)) {
                    break;
                }
            }
        } finally {
            activeNormalizeBursts.delete(file.path);
        }
    })();
}

function getActiveCanvasContext(plugin: MyPlugin, event: Event, options: CanvasContextOptions = {}): CanvasContext | null {
    const view = plugin.app.workspace.activeLeaf?.view as CanvasContext['view'] | undefined;
    if (!view?.getViewType || view.getViewType() !== 'canvas') {
        return null;
    }

    const target = event.target;
    const ownerDocument = target instanceof Node ? target.ownerDocument : null;
    const focusTarget = target instanceof Element ? target : ownerDocument?.activeElement ?? null;

    if (focusTarget instanceof Element) {
        if (focusTarget.closest('input, textarea, .cm-editor')) {
            return null;
        }

        if (options.requireTargetInView && view.containerEl && !view.containerEl.contains(focusTarget)) {
            return null;
        }
    } else if (options.requireTargetInView) {
        return null;
    }

    const file = plugin.app.workspace.getActiveFile();
    if (!file || file.extension !== 'canvas') {
        return null;
    }

    return { file, view };
}

function getDroppedUrl(event: DragEvent): string | null {
    const candidates = [
        event.dataTransfer?.getData('text/uri-list'),
        event.dataTransfer?.getData('text/plain'),
    ];

    for (const candidate of candidates) {
        if (!candidate) {
            continue;
        }

        const url = candidate
            .split('\n')
            .map((line) => line.trim())
            .find((line) => line && !line.startsWith('#'));

        if (url && /^https?:\/\/[^\s]+$/.test(url) && !url.startsWith('http://localhost')) {
            return url;
        }
    }

    return null;
}

async function handleCanvasPaste(event: ClipboardEvent, plugin: MyPlugin): Promise<void> {
    if (event.defaultPrevented) {
        return;
    }

    const context = getActiveCanvasContext(plugin, event);
    if (!context) {
        return;
    }

    const clipboardData = event.clipboardData;
    const clipboardFiles = getTransferFiles(clipboardData);
    const shouldHandleFiles = shouldUploadTransferFiles(clipboardFiles, plugin, 'canvas');
    const clipboardText = clipboardData?.getData('text/plain')?.trim() || '';
    const shouldHandleUrl = Boolean(
        clipboardText &&
        /^https?:\/\/[^\s]+$/.test(clipboardText) &&
        !clipboardText.startsWith('http://localhost') &&
        shouldUploadExternalUrl(plugin, 'canvas')
    );

    if (shouldHandleFiles || shouldHandleUrl) {
        consumeHandledEvent(event);
    }

    if (clipboardFiles.length > 0 && !shouldHandleFiles) {
        return;
    }

    if (shouldHandleFiles) {
        for (const file of clipboardFiles) {
            try {
                const filePath = await getTransferFilePath(file);
                const resolvedLink = await resolveFilePathToEagleLink(filePath, plugin);
                await appendCanvasLinkNode(plugin, context.file, context.view, resolvedLink);
                new Notice(`Canvas node added: ${resolvedLink.fileName}`);
            } catch (error) {
                new Notice('Canvas import failed, check if Eagle is running');
            }
        }

        return;
    }

    if (!clipboardText || !/^https?:\/\/[^\s]+$/.test(clipboardText) || clipboardText.startsWith('http://localhost')) {
        return;
    }

    if (!shouldUploadExternalUrl(plugin, 'canvas')) {
        return;
    }

    try {
        const resolvedLink = await resolveUrlToEagleLink(clipboardText, plugin);
        await appendCanvasLinkNode(plugin, context.file, context.view, resolvedLink);
        new Notice(`Canvas node added: ${resolvedLink.fileName}`);
    } catch (error) {
        new Notice('URL upload failed');
    }
}

async function handleCanvasDrop(event: DragEvent, plugin: MyPlugin): Promise<void> {
    if (event.defaultPrevented) {
        return;
    }

    const context = getActiveCanvasContext(plugin, event, { requireTargetInView: true });
    if (!context) {
        return;
    }

    const transferFiles = Array.from(event.dataTransfer?.files ?? []);
    if (transferFiles.length > 0) {
        if (!shouldUploadTransferFiles(transferFiles, plugin, 'canvas')) {
            return;
        }

        consumeHandledEvent(event);

        for (const file of transferFiles) {
            try {
                const filePath = await getTransferFilePath(file);
                const resolvedLink = await resolveFilePathToEagleLink(filePath, plugin);
                await appendCanvasLinkNode(plugin, context.file, context.view, resolvedLink);
                new Notice(`Canvas node added: ${resolvedLink.fileName}`);
            } catch (error) {
                new Notice('Canvas import failed, check if Eagle is running');
            }
        }

        return;
    }

    const droppedUrl = getDroppedUrl(event);
    if (!droppedUrl || !shouldUploadExternalUrl(plugin, 'canvas')) {
        return;
    }

    consumeHandledEvent(event);

    try {
        const resolvedLink = await resolveUrlToEagleLink(droppedUrl, plugin);
        await appendCanvasLinkNode(plugin, context.file, context.view, resolvedLink);
        new Notice(`Canvas node added: ${resolvedLink.fileName}`);
    } catch (error) {
        new Notice('URL upload failed');
    }
}

async function appendCanvasLinkNode(
    plugin: MyPlugin,
    canvasFile: TFile,
    view: CanvasContext['view'],
    resolvedLink: ResolvedEagleLink,
): Promise<void> {
    const nodeSize = await getCanvasNodeSize(resolvedLink);
    const nodeUrl = await resolveCanvasNodeUrl(resolvedLink);

    await plugin.app.vault.process(canvasFile, (raw) => {
        const canvasData = parseCanvasData(raw);
        canvasData.nodes.push(createCanvasLinkNode(plugin, canvasData.nodes, view, resolvedLink, nodeSize, nodeUrl));
        return `${JSON.stringify(canvasData, null, 2)}\n`;
    });

    scheduleNormalizeCanvasFile(plugin, canvasFile, 50);
}

function parseCanvasData(raw: string): CanvasData {
    if (!raw.trim()) {
        return { nodes: [], edges: [] };
    }

    const parsed = JSON.parse(raw) as Partial<CanvasData>;
    return {
        ...parsed,
        nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
        edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    };
}

async function getCanvasNodeSize(resolvedLink: ResolvedEagleLink): Promise<{ width: number; height: number }> {
    if (!resolvedLink.isImage) {
        return { width: DEFAULT_LINK_WIDTH, height: DEFAULT_LINK_HEIGHT };
    }

    const dimensions = await readImageDimensions(resolvedLink.url);
    if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
        return { width: DEFAULT_LINK_WIDTH, height: DEFAULT_LINK_HEIGHT };
    }

    const aspect = dimensions.width / dimensions.height;
    const width = Math.max(MIN_IMAGE_NODE_WIDTH, Math.min(MAX_IMAGE_NODE_WIDTH, dimensions.width));
    const mediaHeight = Math.round(width / aspect);

    return {
        width,
        height: Math.max(MIN_IMAGE_NODE_HEIGHT, mediaHeight),
    };
}

function readImageDimensions(url: string): Promise<{ width: number; height: number } | null> {
    return new Promise((resolve) => {
        const img = new Image();
        const done = (value: { width: number; height: number } | null) => {
            img.onload = null;
            img.onerror = null;
            resolve(value);
        };

        const timer = setTimeout(() => done(null), 4000);
        img.onload = () => {
            clearTimeout(timer);
            done({ width: img.naturalWidth, height: img.naturalHeight });
        };
        img.onerror = () => {
            clearTimeout(timer);
            done(null);
        };
        img.src = url;
    });
}

function buildCanvasEmbedUrl(rawImageUrl: string): string {
    const parsedUrl = new URL(rawImageUrl);
    return `${parsedUrl.origin}/__eaglebridge__/canvas-image?src=${encodeURIComponent(rawImageUrl)}`;
}

function buildCanvasResourceUrl(resolvedLink: ResolvedEagleLink): string {
    if (!resolvedLink.fileName || !EAGLE_ITEM_URL_REGEX.test(resolvedLink.url)) {
        return resolvedLink.url;
    }

    const parsedUrl = new URL(resolvedLink.url);
    return `${parsedUrl.origin}/__eaglebridge__/canvas-resource?src=${encodeURIComponent(resolvedLink.url)}&filename=${encodeURIComponent(resolvedLink.fileName)}`;
}

function buildCanvasDirectFileUrl(resolvedLink: ResolvedEagleLink): string {
    if (!resolvedLink.fileName || !EAGLE_ITEM_URL_REGEX.test(resolvedLink.url)) {
        return resolvedLink.url;
    }

    return `${resolvedLink.url}/${encodeURIComponent(resolvedLink.fileName)}`;
}

function getResolvedLinkExtension(resolvedLink: ResolvedEagleLink): string {
    const ext = resolvedLink.fileName ? resolvedLink.fileName.match(/\.[^.]+$/)?.[0] : '';
    return ext ? ext.toLowerCase() : '';
}

async function resolveCanvasBookmarkUrl(resolvedLink: ResolvedEagleLink): Promise<string | null> {
    if (getResolvedLinkExtension(resolvedLink) !== '.url' || !EAGLE_ITEM_URL_REGEX.test(resolvedLink.url)) {
        return null;
    }

    try {
        const metadataUrl = `${resolvedLink.url}/metadata.json`;
        const response = await fetch(metadataUrl, {
            method: 'GET',
        });
        if (!response.ok) {
            return null;
        }

        const metadata = await response.json();
        if (typeof metadata?.url === 'string' && /^https?:\/\//i.test(metadata.url)) {
            return metadata.url;
        }
    } catch (error) {
        print('Canvas bookmark resolution failed', error);
    }

    return null;
}

async function resolveCanvasNodeUrl(resolvedLink: ResolvedEagleLink): Promise<string> {
    if (resolvedLink.isImage) {
        return buildCanvasEmbedUrl(resolvedLink.url);
    }

    const extension = getResolvedLinkExtension(resolvedLink);

    if (extension === '.url') {
        const bookmarkUrl = await resolveCanvasBookmarkUrl(resolvedLink);
        if (bookmarkUrl) {
            return bookmarkUrl;
        }
    }

    if (extension === '.pdf') {
        return buildCanvasDirectFileUrl(resolvedLink);
    }

    return buildCanvasResourceUrl(resolvedLink);
}

function getNodeImageSourceUrl(node: ManagedCanvasLinkNode): string | null {
    if (typeof node.eagleBridgeSourceUrl === 'string' && node.eagleBridgeSourceUrl.length > 0) {
        return node.eagleBridgeSourceUrl;
    }
    
    if (typeof node.url === 'string' && EAGLE_IMAGE_URL_REGEX.test(node.url)) {
        return node.url;
    }

    return null;
}

function parseTransformOrigin(value: string, fallbackWidth: number, fallbackHeight: number): { x: number; y: number } {
    const [rawX = '0', rawY = '0'] = value.split(' ');
    const parseAxis = (raw: string, size: number): number => {
        if (raw.endsWith('%')) {
            const percent = Number.parseFloat(raw);
            return Number.isFinite(percent) ? (size * percent) / 100 : 0;
        }
        const pixels = Number.parseFloat(raw);
        return Number.isFinite(pixels) ? pixels : 0;
    };

    return {
        x: parseAxis(rawX, fallbackWidth),
        y: parseAxis(rawY, fallbackHeight),
    };
}

function pickNumericValue(...values: unknown[]): number | null {
    for (const value of values) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
    }
    return null;
}

function getElementOffsetRelativeToAncestor(
    element: HTMLElement,
    ancestor: HTMLElement,
): { x: number; y: number } | null {
    let x = 0;
    let y = 0;
    let current: HTMLElement | null = element;

    while (current && current !== ancestor) {
        x += current.offsetLeft;
        y += current.offsetTop;
        current = current.offsetParent as HTMLElement | null;
    }

    if (current === ancestor) {
        return { x, y };
    }

    if (!ancestor.contains(element)) {
        return null;
    }

    const ancestorRect = ancestor.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    return {
        x: elementRect.left - ancestorRect.left,
        y: elementRect.top - ancestorRect.top,
    };
}

function getElementDebugLabel(element: HTMLElement): string {
    const tagName = element.tagName.toLowerCase();
    const className = typeof element.className === 'string'
        ? element.className.trim().replace(/\s+/g, '.')
        : '';
    return className ? `${tagName}.${className}` : tagName;
}

function getTransformedCanvasElement(containerEl: HTMLElement): HTMLElement | null {
    const preferredSelectors = [
        '.canvas-wrapper',
        '.canvas-viewport',
        '.canvas-container',
        '.canvas-content',
        '.canvas-background',
    ];

    const candidates = new Set<HTMLElement>();
    for (const selector of preferredSelectors) {
        const element = containerEl.querySelector<HTMLElement>(selector);
        if (element) {
            candidates.add(element);
        }
    }

    for (const element of Array.from(containerEl.querySelectorAll<HTMLElement>('[class*="canvas"]')).slice(0, 80)) {
        candidates.add(element);
    }

    let best: { element: HTMLElement; area: number } | null = null;
    for (const element of candidates) {
        const style = window.getComputedStyle(element);
        const hasTransform = style.transform && style.transform !== 'none';
        if (!hasTransform) {
            continue;
        }

        const rect = element.getBoundingClientRect();
        const area = Math.max(0, rect.width) * Math.max(0, rect.height);
        if (!best || area > best.area) {
            best = { element, area };
        }
    }

    return best?.element ?? null;
}

function collectCanvasTransformCandidates(containerEl: HTMLElement): Array<Record<string, unknown>> {
    const candidates = new Set<HTMLElement>();
    for (const element of Array.from(containerEl.querySelectorAll<HTMLElement>('[class*="canvas"]')).slice(0, 30)) {
        candidates.add(element);
    }

    return Array.from(candidates).map((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
            label: getElementDebugLabel(element),
            transform: style.transform,
            transformOrigin: style.transformOrigin,
            width: rect.width,
            height: rect.height,
            left: rect.left,
            top: rect.top,
        };
    });
}

function getCanvasRuntimeCenterPosition(
    view: CanvasContext['view'],
    size: { width: number; height: number },
): { x: number; y: number; diagnostics: Record<string, unknown> } | null {
    const runtimeCanvas = (view as any)?.canvas;
    const viewportHost = view.containerEl?.querySelector<HTMLElement>('.view-content') || view.containerEl;
    if (!runtimeCanvas || !viewportHost) {
        return null;
    }

    const zoom = pickNumericValue(
        runtimeCanvas.zoom,
        runtimeCanvas.tZoom,
        runtimeCanvas.viewport?.zoom,
        runtimeCanvas.viewport?.scale,
    );
    const tx = pickNumericValue(
        runtimeCanvas.tx,
        runtimeCanvas.x,
        runtimeCanvas.panX,
        runtimeCanvas.viewport?.x,
        runtimeCanvas.viewport?.tx,
    );
    const ty = pickNumericValue(
        runtimeCanvas.ty,
        runtimeCanvas.y,
        runtimeCanvas.panY,
        runtimeCanvas.viewport?.y,
        runtimeCanvas.viewport?.ty,
    );

    if (zoom === null || tx === null || ty === null || zoom === 0) {
        return null;
    }

    return {
        x: Math.round((viewportHost.clientWidth / 2 - tx) / zoom - size.width / 2),
        y: Math.round((viewportHost.clientHeight / 2 - ty) / zoom - size.height / 2),
        diagnostics: {
            strategy: 'runtime',
            zoom,
            tx,
            ty,
            viewportWidth: viewportHost.clientWidth,
            viewportHeight: viewportHost.clientHeight,
        },
    };
}

function getCanvasViewportCenterPosition(
    plugin: MyPlugin,
    view: CanvasContext['view'],
    size: { width: number; height: number },
): { x: number; y: number } | null {
    const containerEl = view.containerEl;
    if (!containerEl) {
        const runtimePosition = getCanvasRuntimeCenterPosition(view, size);
        if (plugin.settings.debug) {
            print('Canvas positioning: container missing, runtime fallback', runtimePosition?.diagnostics ?? null);
        }
        return runtimePosition ? { x: runtimePosition.x, y: runtimePosition.y } : null;
    }

    const viewportEl = containerEl.querySelector<HTMLElement>('.view-content') || containerEl;
    const transformHostEl = getTransformedCanvasElement(containerEl);
    if (!viewportEl || !transformHostEl) {
        const runtimePosition = getCanvasRuntimeCenterPosition(view, size);
        if (plugin.settings.debug) {
            print('Canvas positioning: viewport or wrapper missing, runtime fallback', {
                hasViewport: Boolean(viewportEl),
                transformCandidates: collectCanvasTransformCandidates(containerEl),
                runtime: runtimePosition?.diagnostics ?? null,
            });
        }
        return runtimePosition ? { x: runtimePosition.x, y: runtimePosition.y } : null;
    }

    const viewportRect = viewportEl.getBoundingClientRect();
    if (viewportRect.width <= 0 || viewportRect.height <= 0) {
        const runtimePosition = getCanvasRuntimeCenterPosition(view, size);
        if (plugin.settings.debug) {
            print('Canvas positioning: viewport rect invalid, runtime fallback', {
                viewportRect: {
                    width: viewportRect.width,
                    height: viewportRect.height,
                },
                runtime: runtimePosition?.diagnostics ?? null,
            });
        }
        return runtimePosition ? { x: runtimePosition.x, y: runtimePosition.y } : null;
    }

    const wrapperStyle = window.getComputedStyle(transformHostEl);
    const rawTransform = wrapperStyle.transform === 'none' ? undefined : wrapperStyle.transform;
    const matrix = rawTransform ? new DOMMatrixReadOnly(rawTransform) : new DOMMatrixReadOnly();
    const origin = parseTransformOrigin(wrapperStyle.transformOrigin, transformHostEl.clientWidth, transformHostEl.clientHeight);
    const wrapperOffset = getElementOffsetRelativeToAncestor(transformHostEl, viewportEl);
    const runtimePosition = getCanvasRuntimeCenterPosition(view, size);
    if (!wrapperOffset) {
        if (plugin.settings.debug) {
            print('Canvas positioning: wrapper offset unavailable, runtime fallback', {
                transformHost: getElementDebugLabel(transformHostEl),
                transformCandidates: collectCanvasTransformCandidates(containerEl),
                runtime: runtimePosition?.diagnostics ?? null,
            });
        }
        return runtimePosition ? { x: runtimePosition.x, y: runtimePosition.y } : null;
    }

    const transform = new DOMMatrixReadOnly()
        .translate(wrapperOffset.x + origin.x, wrapperOffset.y + origin.y)
        .multiply(matrix)
        .translate(-origin.x, -origin.y);

    let inverted: DOMMatrixReadOnly;
    try {
        inverted = transform.inverse();
    } catch {
        return null;
    }

    const centerInViewport = new DOMPoint(viewportRect.width / 2, viewportRect.height / 2);
    const centerInCanvas = centerInViewport.matrixTransform(inverted);
    const domPosition = {
        x: Math.round(centerInCanvas.x - size.width / 2),
        y: Math.round(centerInCanvas.y - size.height / 2),
    };

    if (plugin.settings.debug) {
        print('Canvas positioning diagnostics', {
            dom: {
                strategy: 'dom',
                viewportRect: {
                    width: viewportRect.width,
                    height: viewportRect.height,
                    left: viewportRect.left,
                    top: viewportRect.top,
                },
                transformHost: getElementDebugLabel(transformHostEl),
                wrapperOffset,
                wrapperSize: {
                    width: transformHostEl.clientWidth,
                    height: transformHostEl.clientHeight,
                },
                transformOrigin: {
                    raw: wrapperStyle.transformOrigin,
                    parsed: origin,
                },
                transform: rawTransform ?? 'none',
                canvasCenter: {
                    x: centerInCanvas.x,
                    y: centerInCanvas.y,
                },
                nodePosition: domPosition,
                transformCandidates: collectCanvasTransformCandidates(containerEl),
            },
            runtime: runtimePosition?.diagnostics ?? null,
        });
    }

    return domPosition;
}

function createCanvasLinkNode(
    plugin: MyPlugin,
    nodes: AllCanvasNodeData[],
    view: CanvasContext['view'],
    resolvedLink: ResolvedEagleLink,
    size: { width: number; height: number },
    nodeUrl: string,
): ManagedCanvasLinkNode {
    const centeredPosition = getCanvasViewportCenterPosition(plugin, view, size);
    const position = centeredPosition || getNextCanvasPosition(nodes, size);
    const node = {
        id: createCanvasNodeId(),
        type: 'link' as const,
        url: nodeUrl,
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };

    if (plugin.settings.debug) {
        print('Canvas node placement', {
            mode: centeredPosition ? 'center' : 'fallback',
            position,
            size,
            url: resolvedLink.url,
            nodeUrl,
            fileName: resolvedLink.fileName,
            isImage: resolvedLink.isImage,
        });
    }

    if (resolvedLink.isImage && size.height > 0) {
        return {
            ...node,
            eagleBridgeAspect: size.width / size.height,
            eagleBridgeManaged: true,
            eagleBridgeSourceUrl: resolvedLink.url,
            eagleBridgeLastWidth: size.width,
            eagleBridgeLastHeight: size.height,
        };
    }

    return node;
}

 function getNextCanvasPosition(nodes: AllCanvasNodeData[], size: { width: number; height: number }): { x: number; y: number } {
    if (nodes.length === 0) {
        return {
            x: -Math.round(size.width / 2),
            y: -Math.round(size.height / 2),
        };
    }

    const maxRight = Math.max(...nodes.map((node) => node.x + node.width));
    const top = Math.min(...nodes.map((node) => node.y));

    return {
        x: maxRight + CANVAS_NODE_GAP,
        y: top,
    };
}

function createCanvasNodeId(): string {
    return `eaglebridge-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function isEagleImageNode(node: AllCanvasNodeData): node is ManagedCanvasLinkNode {
    if (node.type !== 'link' || typeof node.url !== 'string') {
        return false;
    }

    if (EAGLE_IMAGE_URL_REGEX.test(node.url)) {
        return true;
    }

    return EAGLE_CANVAS_EMBED_URL_REGEX.test(node.url) && typeof (node as ManagedCanvasLinkNode).eagleBridgeSourceUrl === 'string';
}

async function normalizeCanvasFile(plugin: MyPlugin, file: TFile): Promise<boolean> {
    if (normalizingCanvasFiles.has(file.path)) {
        return false;
    }

    normalizingCanvasFiles.add(file.path);
    try {
        const raw = await plugin.app.vault.read(file);
        const canvasData = parseCanvasData(raw);
        let changed = false;

        for (const node of canvasData.nodes) {
            if (!isEagleImageNode(node)) {
                continue;
            }

            const sourceUrl = getNodeImageSourceUrl(node);
            if (!sourceUrl) {
                continue;
            }

            const expectedEmbedUrl = buildCanvasEmbedUrl(sourceUrl);
            if (node.url !== expectedEmbedUrl) {
                node.url = expectedEmbedUrl;
                changed = true;
            }

            let aspect = typeof node.eagleBridgeAspect === 'number' && node.eagleBridgeAspect > 0
                ? node.eagleBridgeAspect
                : 0;

            if (!aspect) {
                const dimensions = await readImageDimensions(sourceUrl);
                if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
                    continue;
                }
                aspect = dimensions.width / dimensions.height;
                node.eagleBridgeAspect = aspect;
                changed = true;
            }

            if (node.eagleBridgeSourceUrl !== sourceUrl) {
                node.eagleBridgeSourceUrl = sourceUrl;
                changed = true;
            }

            const previousWidth = typeof node.eagleBridgeLastWidth === 'number' && node.eagleBridgeLastWidth > 0
                ? node.eagleBridgeLastWidth
                : node.width;
            const previousHeight = typeof node.eagleBridgeLastHeight === 'number' && node.eagleBridgeLastHeight > 0
                ? node.eagleBridgeLastHeight
                : node.height;
            const widthChanged = Math.abs(node.width - previousWidth) > 1;
            const heightChanged = Math.abs(node.height - previousHeight) > 1;

            let nextWidth = node.width;
            let nextHeight = node.height;

            if (widthChanged) {
                nextHeight = Math.max(1, Math.round(node.width / aspect));
            } else if (heightChanged) {
                nextWidth = Math.max(1, Math.round(node.height * aspect));
            } else {
                nextHeight = Math.max(1, Math.round(node.width / aspect));
            }

            if (Math.abs(node.width - nextWidth) > 1) {
                node.width = nextWidth;
                changed = true;
            }

            if (Math.abs(node.height - nextHeight) > 1) {
                node.height = nextHeight;
                changed = true;
            }

            if (!node.eagleBridgeManaged) {
                node.eagleBridgeManaged = true;
                changed = true;
            }

            if (node.eagleBridgeLastWidth !== node.width) {
                node.eagleBridgeLastWidth = node.width;
                changed = true;
            }

            if (node.eagleBridgeLastHeight !== node.height) {
                node.eagleBridgeLastHeight = node.height;
                changed = true;
            }
        }

        if (changed) {
            await plugin.app.vault.modify(file, `${JSON.stringify(canvasData, null, 2)}\n`);
            return true;
        }
    } catch {
        // Ignore malformed or transient canvas data.
        return false;
    } finally {
        normalizingCanvasFiles.delete(file.path);
    }

    return false;
}
