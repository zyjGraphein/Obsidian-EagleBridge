import * as Obsidian from 'obsidian';
// 在文件的顶部或合适的位置添加接口扩展
declare module 'obsidian' {
	interface TFile {
		cache?: () => {};
	}
}