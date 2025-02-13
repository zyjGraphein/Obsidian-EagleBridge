const { exec } = require('child_process');

// 正确的路径定义
const filePath = 'H:\\cs\\ss.library\\images\\M5PMN59UDEH9X.info\\Clip.png';

// 使用 exec 打开文件，确保路径用双引号括起来
exec(`start "" "${filePath}"`, { encoding: 'utf8' }, (error, stdout, stderr) => {
    if (error) {
        console.error('Error opening file:', error);
        return;
    }
    console.log('File opened successfully');
    console.log('stdout:', stdout);
    console.log('stderr:', stderr);
});