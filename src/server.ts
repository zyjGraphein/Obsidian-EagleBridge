import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import chokidar from 'chokidar';
import { EventEmitter } from 'events';
import { print, setDebug } from './main';

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

        const filePath = path.join(libraryPath, req.url || '');

        // 新增：提前验证请求路径是否在 images 目录下
        if (!filePath.startsWith(path.join(libraryPath, 'images') + path.sep)) {
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

                            fs.readFile(imagePath, (err, data) => {
                                if (err) {
                                    console.error('Error reading file:', err);
                                    res.writeHead(404, {'Content-Type': 'text/plain'});
                                    res.end('File not found');
                                } else {
                                    if (imageExt === 'url') {
                                        const content = data.toString('utf8');
                                        const urlMatch = content.match(/URL=(.+)/i);
                                        if (urlMatch && urlMatch[1]) {
                                            res.writeHead(302, { 'Location': urlMatch[1] });
                                            res.end();
                                            return;
                                        }
                                    }
                                    const contentType = getContentType(`.${imageExt}`);
                                    if (contentType === null) {
                                        res.writeHead(204);
                                        res.end();
                                        return;
                                    }
                                    res.writeHead(200, {'Content-Type': contentType});
                                    res.end(data);
                                }
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
                res.setHeader('Cache-Control', 'public, max-age=604800'); // 1 week
                
                fs.readFile(filePath, (err, data) => {
                    if (err) {
                        // console.error('Error reading file:', err);
                        res.writeHead(500, {'Content-Type': 'text/plain'});
                        res.end('Internal Server Error');
                    } else {
                        const ext = path.extname(filePath).toLowerCase();
                        const contentType = getContentType(ext);
                        if (contentType === null) {
                            res.writeHead(204);
                            res.end();
                            return;
                        }
                        if (ext === '.url') {
                            const content = data.toString('utf8');
                            const urlMatch = content.match(/URL=(.+)/i);
                            if (urlMatch && urlMatch[1]) {
                                res.writeHead(302, { 'Location': urlMatch[1] });
                                res.end();
                                return;
                            }
                        }
                        res.writeHead(200, {'Content-Type': contentType});
                        res.end(data);
                    }
                });
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
