const { spawn } = require('child_process');

const filePath = 'H:\\cs\\ss.library\\images\\M5PMN59UDEH9X.info\\Clip你好.png';

// 先 chcp 65001，再执行 start "" "..."
const child = spawn('cmd', [
    '/c',
    'chcp', '65001',
    '&&',
    'start', '', `"${filePath}"`
], { shell: true, encoding: 'utf8' });

child.on('error', (error) => {
    console.error('Error opening file:', error);
});

child.on('exit', (code) => {
    if (code === 0) {
        console.log('File opened successfully');
    } else {
        console.error('Failed to open file with exit code:', code);
    }
});