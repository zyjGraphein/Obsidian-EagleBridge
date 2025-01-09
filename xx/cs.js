const http = require('http');
const fs = require('fs');
const path = require('path');

let server;
const port = 6060;
let isServerRunning = false;

// 创建本地服务器
function startServer(libraryPath) {
	if (isServerRunning) return;
	server = http.createServer((req, res) => {
		const filePath = path.join(libraryPath, req.url);
		console.log('Requested file path:', filePath);

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

function refreshServer(libraryPath) {
	if (!isServerRunning) return;
	server.close(() => {
		isServerRunning = false;
		console.log('Server stopped for refresh.');
		startServer(libraryPath);
	});
}
