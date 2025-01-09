const { spawn } = require('child_process');

const filePath = 'D:\\onedrive\\OneDrive - MSFT\\eagle工作台\\工作台.library\\images\\M5P1KDVJSYQAJ.info\\xxx.png';
// const filePath = 'H:\\cs\\ss.library\\images\\M5PMN59UDEH9X.info\\Clip你好.png';

// 调用 explorer.exe 打开文件
const child = spawn('explorer.exe', [filePath], { shell: true });

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
