import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import chokidar from 'chokidar';
import { EventEmitter } from 'events';
import { print, setDebug } from './main';
import { isPathInsideDirectory } from './eaglePaths';

let server: http.Server;
let isServerRunning = false;
let latestDirUrl: string | null = null;

const urlEmitter = new EventEmitter();

// let exportedData: { imageName?: string; annotation?: string } = {};

function getContentType(ext: string): string | null {
    switch (ext) {
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.png':
            return 'image/png';
        case '.gif':
            return 'image/gif';
        case '.webp':
            return 'image/webp';
        case '.svg':
            return 'image/svg+xml';
        case '.pdf':
            return 'application/pdf';
        case '.mp4':
            return 'video/mp4';
        case '.mp3':
            return 'audio/mpeg';
        case '.ogg':
            return 'audio/ogg';
        case '.wav':
            return 'audio/wav';
        case '.json':
            return 'application/json';
        case '.xml':
            return 'application/xml';
        case '.ico':
            return 'image/x-icon';
        case '.txt':
            return 'text/plain';
        case '.csv':
            return 'text/csv';
        case '.html':
            return 'text/html';
        case '.css':
            return 'text/css';
        case '.js':
            return 'application/javascript';
        // case '.pptx':
        //     return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
        // case '.url':
            // return 'text/plain';
        default:
            return null;
    }
}

function escapeHtmlAttribute(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeHtmlText(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function parseRangeHeader(rangeHeader: string, fileSize: number): { start: number; end: number } | null {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
    if (!match) {
        return null;
    }

    const [, startText, endText] = match;
    if (startText === '' && endText === '') {
        return null;
    }

    let start = 0;
    let end = fileSize - 1;

    if (startText === '') {
        const suffixLength = Number.parseInt(endText, 10);
        if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
            return null;
        }

        start = Math.max(fileSize - suffixLength, 0);
    } else {
        start = Number.parseInt(startText, 10);
        if (!Number.isFinite(start) || start < 0 || start >= fileSize) {
            return null;
        }

        if (endText !== '') {
            end = Number.parseInt(endText, 10);
            if (!Number.isFinite(end)) {
                return null;
            }
        }
    }

    if (end < start) {
        return null;
    }

    return {
        start,
        end: Math.min(end, fileSize - 1),
    };
}

function streamBinaryFile(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    filePath: string,
    contentType: string,
    stats: fs.Stats,
    cacheControl?: string,
): void {
    if (cacheControl) {
        res.setHeader('Cache-Control', cacheControl);
    }

    res.setHeader('Accept-Ranges', 'bytes');

    const rangeHeader = req.headers.range;
    if (typeof rangeHeader === 'string' && rangeHeader.length > 0) {
        const parsedRange = parseRangeHeader(rangeHeader, stats.size);
        if (!parsedRange) {
            res.writeHead(416, {
                'Content-Range': `bytes */${stats.size}`,
            });
            res.end();
            return;
        }

        const { start, end } = parsedRange;
        res.writeHead(206, {
            'Content-Type': contentType,
            'Content-Length': end - start + 1,
            'Content-Range': `bytes ${start}-${end}/${stats.size}`,
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
        return;
    }

    res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stats.size,
    });
    fs.createReadStream(filePath).pipe(res);
}

function getCanvasImageTitle(imageUrl: string, libraryPath: string): string {
    try {
        const parsedUrl = new URL(imageUrl);
        const imagePath = decodeURIComponent(parsedUrl.pathname);
        const match = imagePath.match(/\/images\/([^/]+)\.info$/i);
        if (!match?.[1]) {
            return path.basename(imagePath) || 'Eagle Image';
        }

        const metadataPath = path.join(libraryPath, 'images', `${match[1]}.info`, 'metadata.json');
        if (!fs.existsSync(metadataPath)) {
            return match[1];
        }

        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        if (typeof metadata?.name === 'string' && metadata.name.trim().length > 0) {
            return metadata.name.trim();
        }

        return match[1];
    } catch {
        return 'Eagle Image';
    }
}

function renderCanvasImageEmbedPage(imageUrl: string, title: string): string {
    const safeUrl = escapeHtmlAttribute(imageUrl);
    const safeTitle = escapeHtmlText(title);
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${safeTitle}</title>
    <style>
        html, body {
            margin: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: #fff;
        }
        body {
            display: flex;
        }
        img {
            display: block;
            width: 100%;
            height: 100%;
            object-fit: contain;
            object-position: center;
            background: #fff;
            user-select: none;
            -webkit-user-drag: none;
        }
    </style>
</head>
<body>
    <img src="${safeUrl}" alt="">
</body>
</html>`;
}

function getCanvasResourceTitle(resourceUrl: string, fileName: string | null, libraryPath: string): string {
    const fromFileName = fileName ? path.basename(fileName, path.extname(fileName)).trim() : '';
    if (fromFileName) {
        return fromFileName;
    }

    return getCanvasImageTitle(resourceUrl, libraryPath);
}

function renderCanvasResourceEmbedPage(resourceUrl: string, title: string, fileName: string | null): string {
    const safeUrl = escapeHtmlAttribute(resourceUrl);
    const safeTitle = escapeHtmlText(title);
    const ext = (fileName ? path.extname(fileName) : '').toLowerCase();

    let body = `<iframe src="${safeUrl}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`;
    if (ext === '.pdf') {
        body = `<embed src="${safeUrl}#view=FitH" type="application/pdf">`;
    } else if (ext === '.mp4') {
        body = `<video src="${safeUrl}" controls preload="metadata" playsinline></video>`;
    } else if (ext === '.mp3' || ext === '.ogg' || ext === '.wav') {
        body = `<div class="audio-shell"><audio src="${safeUrl}" controls preload="metadata"></audio></div>`;
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${safeTitle}</title>
    <style>
        html, body {
            margin: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
            background: #fff;
        }
        body {
            display: flex;
            align-items: stretch;
            justify-content: stretch;
        }
        iframe, video, embed {
            display: block;
            width: 100%;
            height: 100%;
            border: 0;
            background: #fff;
        }
        video {
            object-fit: contain;
        }
        .audio-shell {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            box-sizing: border-box;
            background: linear-gradient(180deg, #fafafa 0%, #f0f0f0 100%);
        }
        audio {
            width: 100%;
            max-width: 960px;
        }
    </style>
</head>
<body>
    ${body}
</body>
</html>`;
}

export function startServer(libraryPath: string, port: number) {
    if (isServerRunning) return;
    
    const imagesPath = path.join(libraryPath, 'images');

    // 使用 chokidar 监控 images 目录中新建的文件夹
    const watcher = chokidar.watch(imagesPath, {
        ignored: /(^|[\/\\])\../, // 忽略隐藏文件
        persistent: true,
        depth: 1, // 只监控一级目录
        ignoreInitial: true // 忽略初始添加的文件和文件夹
    });

    watcher.on('addDir', (dirPath) => {
        const relativePath = path.relative(libraryPath, dirPath).replace(/\\/g, '/');
        latestDirUrl = `http://localhost:${port}/${relativePath}`;
        // console.log(`新建文件夹路径: ${latestDirUrl}`);
        urlEmitter.emit('urlUpdated', latestDirUrl);
    });

    server = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
        res.setHeader('Access-Control-Allow-Credentials', 'true');


        // 解析 URL 查询参数
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const pathname = decodeURIComponent(url.pathname);
        const filePath = path.join(libraryPath, pathname);
        const noAutoplay = url.searchParams.has('noautoplay');
        
        // 将参数存储在请求对象中，以便后续处理时使用
        (req as any).noAutoplay = noAutoplay;

        if (pathname === '/__eaglebridge__/canvas-image') {
            const imageUrl = url.searchParams.get('src');
            if (!imageUrl) {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Missing src parameter');
                return;
            }

            const imageTitle = getCanvasImageTitle(imageUrl, libraryPath);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(renderCanvasImageEmbedPage(imageUrl, imageTitle));
            return;
        }

        if (pathname === '/__eaglebridge__/canvas-resource') {
            const resourceUrl = url.searchParams.get('src');
            const fileName = url.searchParams.get('filename');
            if (!resourceUrl) {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Missing src parameter');
                return;
            }

            const resourceTitle = getCanvasResourceTitle(resourceUrl, fileName, libraryPath);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(renderCanvasResourceEmbedPage(resourceUrl, resourceTitle, fileName));
            return;
        }

        // 新增：提前验证请求路径是否在 images 目录下
        if (!isPathInsideDirectory(filePath, path.join(libraryPath, 'images'))) {
            res.writeHead(404);
            res.end();
            return;
        }

        fs.stat(filePath, (err, stats) => {
            if (err) {
                // 修改：静默处理 ENOENT 错误
                if (err.code === 'ENOENT') {
                    res.writeHead(404).end();
                } else {
                    res.writeHead(500).end('Internal Error');
                }
                return;
            }

            if (stats.isDirectory()) {
                const jsonFilePath = path.join(filePath, 'metadata.json');
                
                // 新增：检查 metadata.json 是否存在
                if (!fs.existsSync(jsonFilePath)) {
                    res.writeHead(404).end();
                    return;
                }

                fs.readFile(jsonFilePath, 'utf8', (err, data) => {
                    if (err) {
                        console.error('Error reading JSON file:', err);
                        res.writeHead(500, {'Content-Type': 'text/plain'});
                        res.end('Internal Server Error');
                    } else {
                        try {
                            const info = JSON.parse(data);
                            const imageName = info.name;
                            // exportedData.imageName = imageName;
                            // const annotation = info.annotation;
                            // exportedData.annotation = annotation;
                            const imageExt = info.ext;
                            const imageFile = `${imageName}.${imageExt}`;
                            const imagePath = path.join(filePath, imageFile);

                            fs.stat(imagePath, (fileErr, fileStats) => {
                                if (fileErr || !fileStats.isFile()) {
                                    console.error('Error reading file:', fileErr);
                                    res.writeHead(404, {'Content-Type': 'text/plain'});
                                    res.end('File not found');
                                    return;
                                }

                                if (imageExt === 'url') {
                                    fs.readFile(imagePath, (readErr, data) => {
                                        if (readErr) {
                                            console.error('Error reading file:', readErr);
                                            res.writeHead(404, {'Content-Type': 'text/plain'});
                                            res.end('File not found');
                                            return;
                                        }

                                        const content = data.toString('utf8');
                                        const urlMatch = content.match(/URL=(.+)/i);
                                        if (urlMatch && urlMatch[1]) {
                                            res.writeHead(302, { 'Location': urlMatch[1] });
                                            res.end();
                                            return;
                                        }

                                        res.writeHead(204);
                                        res.end();
                                    });
                                    return;
                                }

                                const contentType = getContentType(`.${imageExt}`);
                                if (contentType === null) {
                                    res.writeHead(204);
                                    res.end();
                                    return;
                                }

                                streamBinaryFile(req, res, imagePath, contentType, fileStats);
                            });
                        } catch (parseErr) {
                            console.error('Error parsing JSON:', parseErr);
                            res.writeHead(500, {'Content-Type': 'text/plain'});
                            res.end('Error parsing JSON');
                        }
                    }
                });
            } else {
                // 新增：缓存验证头
                const ext = path.extname(filePath).toLowerCase();
                const contentType = getContentType(ext);
                if (contentType === null) {
                    res.writeHead(204);
                    res.end();
                    return;
                }

                if (ext === '.url') {
                    fs.readFile(filePath, (readErr, data) => {
                        if (readErr) {
                            res.writeHead(500, {'Content-Type': 'text/plain'});
                            res.end('Internal Server Error');
                            return;
                        }

                        const content = data.toString('utf8');
                        const urlMatch = content.match(/URL=(.+)/i);
                        if (urlMatch && urlMatch[1]) {
                            res.writeHead(302, { 'Location': urlMatch[1] });
                            res.end();
                            return;
                        }

                        res.writeHead(204);
                        res.end();
                    });
                    return;
                }

                streamBinaryFile(req, res, filePath, contentType, stats, 'public, max-age=604800');
            }
        });
    });


    server.listen(port, () => {
        isServerRunning = true;
        print(`Server is running at http://localhost:${port}/`);
    });
}

export function refreshServer(libraryPath: string, port: number) {
    if (!isServerRunning) return;
    server.close(() => {
        isServerRunning = false;
        print('Server stopped for refresh.');
        startServer(libraryPath, port);
    });
}

export function stopServer() {
    if (isServerRunning) {
        server.close(() => {
            isServerRunning = false;
            print('Server stopped.');
        });
    }
}

export function getLatestDirUrl(): string | null {
    return latestDirUrl;
}

export { urlEmitter };

// export { exportedData };
