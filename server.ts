import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import chokidar from 'chokidar';
import { EventEmitter } from 'events';

let server: http.Server;
let isServerRunning = false;
let latestDirUrl: string | null = null;

const urlEmitter = new EventEmitter();

// let exportedData: { imageName?: string; annotation?: string } = {};

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
        latestDirUrl = `http://localhost:${port}/${path.relative(libraryPath, dirPath)}`;
        console.log(`新建文件夹路径: ${latestDirUrl}`);
        urlEmitter.emit('urlUpdated', latestDirUrl);
    });

    server = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
        res.setHeader('Access-Control-Allow-Credentials', 'true');

        const filePath = path.join(libraryPath, req.url || '');
        console.log('Requested file path:', filePath);

        // 检查请求是否为获取名称的请求
        if (req.url?.endsWith('/name')) {
            const dirPath = path.dirname(filePath);
            const jsonFilePath = path.join(dirPath, 'metadata.json');
            fs.readFile(jsonFilePath, 'utf8', (err, data) => {
                if (err) {
                    console.error('Error reading JSON file:', err);
                    res.writeHead(500, {'Content-Type': 'text/plain'});
                    res.end('Internal Server Error');
                } else {
                    try {
                        const info = JSON.parse(data);
                        const imageName = info.name;
                        res.writeHead(200, {'Content-Type': 'text/plain'});
                        res.end(imageName);
                    } catch (parseErr) {
                        console.error('Error parsing JSON:', parseErr);
                        res.writeHead(500, {'Content-Type': 'text/plain'});
                        res.end('Error parsing JSON');
                    }
                }
            });
            return; // 处理完请求后返回
        }

        // 检查请求是否为获取注释的请求
        if (req.url?.endsWith('/annotation')) {
            const dirPath = path.dirname(filePath);
            const jsonFilePath = path.join(dirPath, 'metadata.json');
            fs.readFile(jsonFilePath, 'utf8', (err, data) => {
                if (err) {
                    console.error('Error reading JSON file:', err);
                    res.writeHead(500, {'Content-Type': 'text/plain'});
                    res.end('Internal Server Error');
                } else {
                    try {
                        const info = JSON.parse(data);
                        const annotation = info.annotation;
                        res.writeHead(200, {'Content-Type': 'text/plain'});
                        res.end(annotation);
                    } catch (parseErr) {
                        console.error('Error parsing JSON:', parseErr);
                        res.writeHead(500, {'Content-Type': 'text/plain'});
                        res.end('Error parsing JSON');
                    }
                }
            });
            return; // 处理完请求后返回
        }
        // 检查请求是否为获取tags的请求
        if (req.url?.endsWith('/tags')) {
            const dirPath = path.dirname(filePath);
            const jsonFilePath = path.join(dirPath, 'metadata.json');
            fs.readFile(jsonFilePath, 'utf8', (err, data) => {
                if (err) {
                    console.error('Error reading JSON file:', err);
                    res.writeHead(500, {'Content-Type': 'text/plain'});
                    res.end('Internal Server Error');
                } else {
                    try {
                        const info = JSON.parse(data);
                        const tags = info.tags;
                        res.writeHead(200, {'Content-Type': 'application/json'});
                        res.end(tags.join(','));
                    } catch (parseErr) {
                        console.error('Error parsing JSON:', parseErr);
                        res.writeHead(500, {'Content-Type': 'text/plain'});
                        res.end('Error parsing JSON');
                    }
                }
            });
            return; // 处理完请求后返回
        }
        // 检查请求是否为获取url的请求
        if (req.url?.endsWith('/url')) {
            const dirPath = path.dirname(filePath);
            const jsonFilePath = path.join(dirPath, 'metadata.json');
            fs.readFile(jsonFilePath, 'utf8', (err, data) => {
                if (err) {
                    console.error('Error reading JSON file:', err);
                    res.writeHead(500, {'Content-Type': 'text/plain'});
                    res.end('Internal Server Error');
                } else {
                    try {
                        const info = JSON.parse(data);
                        const url = info.url;
                        res.writeHead(200, {'Content-Type': 'text/plain'});
                        res.end(url);
                    } catch (parseErr) {
                        console.error('Error parsing JSON:', parseErr);
                        res.writeHead(500, {'Content-Type': 'text/plain'});
                        res.end('Error parsing JSON');
                    }
                }
            });
            return; // 处理完请求后返回
        }

        fs.stat(filePath, (err, stats) => {
            if (err) {
                console.error('Error accessing file path:', err);
                res.writeHead(404, {'Content-Type': 'text/plain'});
                res.end('Not Found');
            } else if (stats.isDirectory()) {
                const jsonFilePath = path.join(filePath, 'metadata.json');
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
                                    console.error('Error reading image file:', err);
                                    res.writeHead(404, {'Content-Type': 'text/plain'});
                                    res.end('Image not found');
                                } else {
                                    res.writeHead(200, {'Content-Type': 'image/jpeg'});
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
                fs.readFile(filePath, (err, data) => {
                    if (err) {
                        console.error('Error reading file:', err);
                        res.writeHead(500, {'Content-Type': 'text/plain'});
                        res.end('Internal Server Error');
                    } else {
                        res.writeHead(200, {'Content-Type': 'image/jpeg'});
                        res.end(data);
                    }
                });
            }
        });
    });

    server.listen(port, () => {
        isServerRunning = true;
        console.log(`Server is running at http://localhost:${port}/`);
    });
}

export function refreshServer(libraryPath: string, port: number) {
    if (!isServerRunning) return;
    server.close(() => {
        isServerRunning = false;
        console.log('Server stopped for refresh.');
        startServer(libraryPath, port);
    });
}

export function stopServer() {
    if (isServerRunning) {
        server.close(() => {
            isServerRunning = false;
            console.log('Server stopped.');
        });
    }
}

export function getLatestDirUrl(): string | null {
    return latestDirUrl;
}

export { urlEmitter };

// export { exportedData };
