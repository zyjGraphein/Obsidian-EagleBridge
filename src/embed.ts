export function isURL(str: string): boolean {
    try {
        return /^(https?:)$/.test(new URL(str).protocol);
    } catch {
        return false;
    }
}

export function isLocalHostLink(str: string): boolean {
    try {
        const url = new URL(str);
        return isURL(str) && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    } catch {
        return false;
    }
}

export function isAltTextImage(alt: string): boolean {
    return /^.+?\.(jpg|jpeg|png|gif|webp|svg|avif|bmp|ico)(?=$|[\s#\[{(])/i.test(alt.split('|')[0].trim());
}

export interface EmbedResult {
    containerEl: HTMLElement;
    destroy(): void;
}

type EmbedKind = 'video' | 'audio' | 'image' | 'iframe';

function mediaKindFromName(name: string): 'video' | 'audio' | null {
    const filename = name.split('|')[0].trim();
    if (/\.(mp4|m4v|webm|mov|ogv|mkv)(?=$|[\s#?])/i.test(filename)) return 'video';
    if (/\.(mp3|m4a|ogg|wav|flac|aac|opus)(?=$|[\s#?])/i.test(filename)) return 'audio';
    return null;
}

export class LocalHostEmbedder {
    create(src: string, alt = '', doc: Document = document, onResize: () => void = () => {}): EmbedResult {
        const container = doc.createElement('div');
        container.className = 'eagle-embed-container';
        const content = container.appendChild(doc.createElement('div'));
        content.className = 'eagle-embed-content';
        const abort = new AbortController();
        let disposed = false;
        let media: HTMLMediaElement | undefined;
        let image: HTMLImageElement | undefined;
        let iframe: HTMLIFrameElement | undefined;
        const resizeObserver = new ResizeObserver(() => {
            if (media && !container.getClientRects().length) media.pause();
            onResize();
        });
        resizeObserver.observe(container);

        const showError = () => {
            if (disposed) return;
            const link = doc.createElement('a');
            link.className = 'external-link';
            link.href = src;
            link.textContent = `无法预览，打开 ${alt.split('|')[0] || '附件'}`;
            content.replaceChildren(link);
            onResize();
        };

        const render = (kind: EmbedKind) => {
            if (disposed) return;
            let element: HTMLElement;
            if (kind === 'video' || kind === 'audio') {
                media = doc.createElement(kind);
                media.controls = true;
                media.autoplay = false;
                media.preload = 'metadata';
                if (kind === 'video') media.setAttribute('playsinline', '');
                media.onloadedmetadata = onResize;
                media.onerror = showError;
                media.src = src;
                element = media;
            } else if (kind === 'image') {
                image = doc.createElement('img');
                image.alt = alt;
                image.onload = onResize;
                image.onerror = showError;
                image.src = src;
                element = image;
            } else {
                iframe = doc.createElement('iframe');
                iframe.src = src;
                iframe.allow = "autoplay 'none'";
                iframe.allowFullscreen = true;
                iframe.setAttribute('loading', 'lazy');
                iframe.onerror = showError;
                element = iframe;
            }
            content.replaceChildren(element);
            onResize();
        };

        const mediaKind = mediaKindFromName(alt) || mediaKindFromName(new URL(src).pathname);
        if (mediaKind) {
            render(mediaKind);
        } else {
            // Eagle URLs end in .info. Empty/custom alt text needs the real MIME type;
            // opening a raw video URL in an iframe would start the browser's media player.
            content.textContent = '加载预览…';
            void fetch(src, { method: 'HEAD', redirect: 'manual', signal: abort.signal }).then(response => {
                // Eagle bookmarks redirect to websites, which remain iframe embeds.
                if (response.type === 'opaqueredirect') return render('iframe');
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const type = response.headers.get('content-type')?.toLowerCase() || '';
                render(type.startsWith('video/') ? 'video' : type.startsWith('audio/') ? 'audio'
                    : type.startsWith('image/') ? 'image' : 'iframe');
            }).catch(showError);
        }

        return {
            containerEl: container,
            destroy() {
                disposed = true;
                abort.abort();
                resizeObserver.disconnect();
                if (media) {
                    media.onloadedmetadata = media.onerror = null;
                    media.pause();
                    media.removeAttribute('src');
                    media.load();
                }
                if (image) {
                    image.onload = image.onerror = null;
                    image.removeAttribute('src');
                }
                if (iframe) {
                    iframe.onerror = null;
                    iframe.src = 'about:blank';
                }
            },
        };
    }

    shouldEmbed(src: string, alt = ''): boolean {
        return isLocalHostLink(src) && !/noembed/i.test(alt)
            && !isAltTextImage(alt) && !isAltTextImage(new URL(src).pathname);
    }
}

export const embedManager = new LocalHostEmbedder();
