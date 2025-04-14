import * as vscode from 'vscode';
import { ContextInfo } from './contextAnalyzer';

/**
 * 负责格式化生成的代码，使其与源代码风格匹配
 */
export class CodeFormatter {
    /**
     * 格式化单行代码，确保与当前缩进匹配
     * @param code 生成的代码
     * @param indentation 当前行的缩进
     * @returns 格式化后的单行代码
     */
    public formatSingleLine(code: string, indentation: string): string {
        // 清理代码
        let cleanedCode = code.trim();
        
        // 移除可能的前导缩进
        cleanedCode = cleanedCode.replace(/^\s+/, '');
        
        // 确保没有换行符
        cleanedCode = cleanedCode.split('\n')[0];
        
        // 对于单行补全，我们通常不添加缩进，因为它会直接插入到光标位置
        // 但如果我们在行首（空行），则应用缩进
        if (indentation && indentation.length > 0) {
            // 检查是否在添加代码后需要保持缩进
            // 例如，如果代码是块语句的开始或结束，需要保持缩进
            const startsBlock = /^\s*(if|for|while|switch|function|class|else|try|catch)\b/.test(cleanedCode);
            const isBlockEnd = /^\s*[})]/.test(cleanedCode);
            
            if (startsBlock || isBlockEnd) {
                return cleanedCode; // 无需添加额外缩进
            }
        }
        
        return cleanedCode;
    }
    
    /**
     * 格式化代码片段，确保与当前文件缩进风格匹配
     * @param code 生成的代码片段
     * @param baseIndentation 基础缩进
     * @returns 格式化后的代码片段
     */
    public formatCodeSnippet(code: string, baseIndentation: string): string {
        // 清理代码
        const cleanedCode = code.trim();
        
        // 按行分割代码
        const lines = cleanedCode.split('\n');
        
        // 如果只有一行，直接返回
        if (lines.length === 1) {
            return lines[0];
        }
        
        // 确定代码中的最小缩进
        const minIndent = this.getMinimumIndentation(lines);
        
        // 调整每行的缩进
        const formattedLines = lines.map((line, index) => {
            // 跳过空行
            if (line.trim() === '') {
                return '';
            }
            
            // 第一行不需要缩进，因为会插入到光标位置
            if (index === 0) {
                return line.substring(minIndent);
            }
            
            // 其他行需要添加基础缩进
            const trimmedLine = line.substring(minIndent);
            return baseIndentation + trimmedLine;
        });
        
        return formattedLines.join('\n');
    }
    
    /**
     * 应用代码风格到生成的代码
     * @param code 生成的代码
     * @param document 源文档
     * @returns 应用了源文档风格的代码
     */
    public applyCodeStyle(code: string, document: vscode.TextDocument): string {
        // 检测制表符vs空格
        const usesTabsForIndent = this.detectUsesTabsForIndent(document);
        
        // 获取制表符大小或缩进大小
        const tabSize = vscode.workspace.getConfiguration('editor', document.uri).get<number>('tabSize') || 4;
        
        // 适应制表符/空格设置
        if (usesTabsForIndent) {
            // 如果源代码使用制表符，将所有空格缩进转换为制表符
            return this.convertSpacesToTabs(code, tabSize);
        } else {
            // 如果源代码使用空格，确保所有缩进都使用空格
            return this.convertTabsToSpaces(code, tabSize);
        }
    }
    
    /**
     * 获取代码中的最小缩进级别
     * @param lines 代码行
     * @returns 最小缩进的空格数
     */
    private getMinimumIndentation(lines: string[]): number {
        let minIndent = Infinity;
        
        for (const line of lines) {
            // 跳过空行
            if (line.trim() === '') {
                continue;
            }
            
            // 计算行首空格数
            const indent = line.search(/\S|$/);
            if (indent < minIndent) {
                minIndent = indent;
            }
        }
        
        return minIndent === Infinity ? 0 : minIndent;
    }
    
    /**
     * 检测源文档是否使用制表符进行缩进
     * @param document 源文档
     * @returns 是否使用制表符
     */
    private detectUsesTabsForIndent(document: vscode.TextDocument): boolean {
        // 检查前100行（或总行数，如果少于100）
        const linesToCheck = Math.min(document.lineCount, 100);
        let tabCount = 0;
        let spaceCount = 0;
        
        for (let i = 0; i < linesToCheck; i++) {
            const lineText = document.lineAt(i).text;
            
            // 检查行首是否是制表符
            if (lineText.match(/^\t+/)) {
                tabCount++;
            }
            // 检查行首是否是空格
            else if (lineText.match(/^ +/)) {
                spaceCount++;
            }
        }
        
        // 如果制表符出现次数多，则认为使用制表符
        return tabCount > spaceCount;
    }
    
    /**
     * 将空格转换为制表符
     * @param code 代码
     * @param tabSize 制表符大小
     * @returns 转换后的代码
     */
    private convertSpacesToTabs(code: string, tabSize: number): string {
        // 创建正则表达式匹配行首的空格
        const spaceIndentRegex = new RegExp(`^( {${tabSize}})`, 'gm');
        
        // 替换每一组tabSize数量的空格为一个制表符
        let result = code;
        let matches;
        
        while ((matches = spaceIndentRegex.exec(result)) !== null) {
            result = result.replace(spaceIndentRegex, '\t');
        }
        
        return result;
    }
    
    /**
     * 将制表符转换为空格
     * @param code 代码
     * @param tabSize 制表符大小
     * @returns 转换后的代码
     */
    private convertTabsToSpaces(code: string, tabSize: number): string {
        // 创建空格字符串替换制表符
        const spaces = ' '.repeat(tabSize);
        
        // 替换所有制表符为空格
        return code.replace(/\t/g, spaces);
    }
}