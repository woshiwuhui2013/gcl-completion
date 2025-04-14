import * as vscode from 'vscode';

/**
 * 负责分析编辑器中的代码上下文
 */
export class ContextAnalyzer {
    /**
     * 获取当前光标位置周围的代码上下文
     * @param editor 活动编辑器
     * @returns 代码上下文信息
     */
    public getContext(editor: vscode.TextEditor): ContextInfo {
        const document = editor.document;
        const cursorPosition = editor.selection.active;
        
        // 获取配置的上下文行数
        const config = vscode.workspace.getConfiguration('llm-code-assistant');
        const contextLineCount = config.get<number>('contextLineCount') || 50;
        
        // 计算上下文范围
        const startLine = Math.max(0, cursorPosition.line - contextLineCount);
        const endLine = Math.min(document.lineCount - 1, cursorPosition.line + contextLineCount);
        
        // 获取上文的代码
        let beforeCode = '';
        for (let i = startLine; i < cursorPosition.line; i++) {
            beforeCode += document.lineAt(i).text + '\n';
        }
        
        // 获取光标所在行的代码（分为光标前和光标后）
        const currentLine = document.lineAt(cursorPosition.line);
        const beforeCursor = currentLine.text.substring(0, cursorPosition.character);
        const afterCursor = currentLine.text.substring(cursorPosition.character);
        
        // 获取下文的代码
        let afterCode = '';
        for (let i = cursorPosition.line + 1; i <= endLine; i++) {
            afterCode += document.lineAt(i).text + '\n';
        }
        
        // 获取光标位置的缩进
        const indentation = this.getIndentation(beforeCursor);
        
        // 智能分析缩进
        const expectedIndentation = this.analyzeExpectedIndentation(
            document, 
            cursorPosition, 
            beforeCursor,
            indentation
        );
        
        // 获取文件语言
        const languageId = document.languageId;
        
        // 获取文件名
        const fileName = document.fileName.split(/[/\\]/).pop() || '';
        
        // 获取符号信息
        const symbolInfo = this.analyzeNearbySymbols(document, cursorPosition);
        
        // 返回上下文信息
        return {
            beforeCode,
            beforeCursor,
            afterCursor,
            afterCode,
            indentation,
            expectedIndentation,
            languageId,
            fileName,
            cursorPosition,
            symbolInfo
        };
    }
    
    /**
     * 智能分析应该使用的缩进
     * 这在代码块开始处特别有用，比如if语句后面
     * @param document 文档
     * @param position 位置
     * @param beforeCursor 光标前的文本
     * @param currentIndentation 当前缩进
     */
    private analyzeExpectedIndentation(
        document: vscode.TextDocument,
        position: vscode.Position,
        beforeCursor: string,
        currentIndentation: string
    ): string {
        // 获取编辑器配置
        const tabSize = vscode.workspace.getConfiguration('editor', document.uri).get<number>('tabSize') || 4;
        const insertSpaces = vscode.workspace.getConfiguration('editor', document.uri).get<boolean>('insertSpaces', true);
        
        // 检查前一行是否以块语句结尾（如if, for, while等）
        const lineText = beforeCursor.trim();
        const prevLineNum = position.line - 1;
        
        if (prevLineNum >= 0) {
            const prevLine = document.lineAt(prevLineNum).text.trim();
            
            // 检查上一行是否以块语句开头标记结尾
            const blockStarters = [
                // C风格语言
                /[{([]$/,
                // 代码块开始的关键字
                /(if|for|while|else|switch|try|catch|finally|do|class|interface|enum)\s*\([^)]*\)\s*$/,
                /\b(if|for|while|else|switch|try|catch|finally|do|class|interface|enum)\s*$/,
                // Python/Ruby风格
                /:\s*$/
            ];
            
            for (const pattern of blockStarters) {
                if (pattern.test(prevLine)) {
                    // 需要增加一级缩进
                    if (insertSpaces) {
                        return currentIndentation + ' '.repeat(tabSize);
                    } else {
                        return currentIndentation + '\t';
                    }
                }
            }
        }
        
        // 如果当前行有开始括号但没有结束括号，可能需要增加缩进
        const openBrackets = (beforeCursor.match(/[{([]/) || []).length;
        const closeBrackets = (beforeCursor.match(/[})\]]/) || []).length;
        
        if (openBrackets > closeBrackets) {
            // 需要增加一级缩进
            if (insertSpaces) {
                return currentIndentation + ' '.repeat(tabSize);
            } else {
                return currentIndentation + '\t';
            }
        }
        
        // 返回当前的缩进
        return currentIndentation;
    }
    
    /**
     * 分析附近的符号（变量、函数等）
     * @param document 文档
     * @param position 位置
     */
    private analyzeNearbySymbols(document: vscode.TextDocument, position: vscode.Position): string[] {
        const symbols: string[] = [];
        const uniqueSymbols = new Set<string>();
        
        // 简单的符号提取正则表达式
        const symbolRegex = /\b[a-zA-Z_]\w*\b/g;
        
        // 检查周围10行的符号
        const startLine = Math.max(0, position.line - 10);
        const endLine = Math.min(document.lineCount - 1, position.line + 10);
        
        for (let i = startLine; i <= endLine; i++) {
            const lineText = document.lineAt(i).text;
            let match;
            
            while ((match = symbolRegex.exec(lineText)) !== null) {
                const symbol = match[0];
                // 排除关键字
                if (!this.isKeyword(symbol, document.languageId)) {
                    uniqueSymbols.add(symbol);
                }
            }
        }
        
        return Array.from(uniqueSymbols);
    }
    
    /**
     * 检查是否是编程语言关键字
     * @param word 单词
     * @param languageId 语言ID
     */
    private isKeyword(word: string, languageId: string): boolean {
        // 基于语言ID选择不同的关键字集
        let keywords: Set<string>;
        
        switch (languageId) {
            case 'python':
                keywords = new Set([
                    'if', 'elif', 'else', 'for', 'while', 'def', 'class', 'try',
                    'except', 'finally', 'with', 'as', 'import', 'from', 'return',
                    'yield', 'break', 'continue', 'pass', 'True', 'False', 'None',
                    'and', 'or', 'not', 'is', 'in', 'lambda', 'global', 'nonlocal'
                ]);
                break;
                
            case 'javascript':
            case 'typescript':
                keywords = new Set([
                    'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break',
                    'continue', 'return', 'try', 'catch', 'finally', 'throw',
                    'new', 'delete', 'var', 'let', 'const', 'function', 'class',
                    'this', 'super', 'import', 'export', 'from', 'as', 'async', 'await',
                    'static', 'public', 'private', 'protected', 'extends', 'implements',
                    'interface', 'enum', 'package', 'true', 'false', 'null', 'undefined',
                    'void', 'typeof'
                ]);
                break;
                
            // 为其他语言添加关键字集
            default:
                // 通用关键字集
                keywords = new Set([
                    'if', 'else', 'for', 'while', 'return', 'break', 'continue',
                    'class', 'function', 'true', 'false', 'null'
                ]);
                break;
        }
        
        return keywords.has(word);
    }
    
    /**
     * 获取当前位置的缩进
     * @param lineText 行文本
     * @returns 缩进字符串
     */
    private getIndentation(lineText: string): string {
        const match = lineText.match(/^(\s*)/);
        return match ? match[1] : '';
    }
    
    /**
     * 分析项目信息
     * @returns 项目信息
     */
    public async analyzeProject(): Promise<ProjectInfo> {
        // 获取工作区文件夹
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return {
                name: '',
                files: [],
                dependencies: []
            };
        }
        
        const rootPath = workspaceFolders[0].uri.fsPath;
        
        // 获取项目名称
        const rootPathParts = rootPath.split(/[/\\]/);
        const name = rootPathParts[rootPathParts.length - 1];
        
        // 尝试读取依赖信息
        let dependencies: string[] = [];
        try {
            // 尝试读取package.json获取依赖信息
            const packageJsonUri = vscode.Uri.file(`${rootPath}/package.json`);
            const packageJsonDocument = await vscode.workspace.openTextDocument(packageJsonUri);
            const packageJson = JSON.parse(packageJsonDocument.getText());
            
            // 合并各类依赖
            dependencies = [
                ...Object.keys(packageJson.dependencies || {}),
                ...Object.keys(packageJson.devDependencies || {})
            ];
        } catch (error) {
            // 如果无法读取package.json，忽略错误
            console.log('无法读取package.json:', error);
        }
        
        // 获取工作区文件列表
        // 注意：对于大型项目，这可能会很慢，未来可能需要限制文件数量
        const files: string[] = [];
        const pattern = new vscode.RelativePattern(workspaceFolders[0], '**/*.{js,ts,jsx,tsx,py,java,c,cpp,html,css}');
        const foundFiles = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 100);
        
        for (const file of foundFiles) {
            const relativePath = vscode.workspace.asRelativePath(file);
            files.push(relativePath);
        }
        
        return {
            name,
            files,
            dependencies
        };
    }
}

/**
 * 代码上下文信息接口
 */
export interface ContextInfo {
    beforeCode: string;
    beforeCursor: string;
    afterCursor: string;
    afterCode: string;
    indentation: string;
    expectedIndentation: string;
    languageId: string;
    fileName: string;
    cursorPosition: vscode.Position;
    symbolInfo: string[];
}

/**
 * 项目信息接口
 */
export interface ProjectInfo {
    name: string;
    files: string[];
    dependencies: string[];
}