import * as vscode from 'vscode';
import { log, debug } from './utils';
import { 
    LanguageSpecificAnalyzer, 
    CodeStructureInfo, 
    EnhancedAnalysisResult,
    TypeScriptAnalyzer,
    PythonAnalyzer,
    JavaAnalyzer,
    GenericAnalyzer
} from './languageAnalyzers';

/**
 * 代码上下文信息接口 - 增强版
 */
export interface ContextInfo {
    // 基础代码上下文
    beforeCode: string;        // 光标前的代码
    beforeCursor: string;      // 光标所在行光标前的代码
    afterCursor: string;       // 光标所在行光标后的代码
    afterCode: string;         // 光标后的代码
    indentation: string;       // 当前缩进
    expectedIndentation: string; // 预期缩进（用于代码块开始）
    languageId: string;        // 文件语言ID
    fileName: string;          // 文件名
    cursorPosition: vscode.Position; // 光标位置
    
    // 符号信息
    symbolInfo: string[];       // 相关符号列表
    
    // 增强分析结果
    codeStructure?: CodeStructureInfo[]; // 代码结构信息
    currentScope?: string;              // 当前代码所在作用域
    relatedImports?: string[];          // 相关的导入语句
    syntaxContext?: string;             // 当前语法上下文
}

/**
 * 项目信息接口
 */
export interface ProjectInfo {
    name: string;             // 项目名称
    files: string[];          // 项目文件列表
    dependencies: string[];   // 项目依赖列表
}
/**
 * 负责分析编辑器中的代码上下文，提供更深入的代码理解
 */
export class ContextAnalyzer {
    // 语言特定的分析器缓存
    private languageAnalyzers: Map<string, LanguageSpecificAnalyzer> = new Map();
    
    /**
     * 获取当前光标位置周围的代码上下文，并增强分析
     * @param editor 活动编辑器
     * @returns 增强的代码上下文信息
     */
    public getContext(editor: vscode.TextEditor): ContextInfo {
        const document = editor.document;
        const cursorPosition = editor.selection.active;
        const languageId = document.languageId;
        
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
        
        // 获取文件名
        const fileName = document.fileName.split(/[/\\]/).pop() || '';
        
        // 进行增强分析
        const enhancedContext = this.performEnhancedAnalysis(
            document,
            cursorPosition,
            beforeCode,
            beforeCursor,
            afterCursor, 
            afterCode
        );
        
        // 返回上下文信息，包含增强分析结果
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
            symbolInfo: enhancedContext.relevantSymbols,
            // 新增增强分析结果
            codeStructure: enhancedContext.codeStructure,
            currentScope: enhancedContext.currentScope,
            relatedImports: enhancedContext.relatedImports,
            syntaxContext: enhancedContext.syntaxContext
        };
    }
    
    /**
     * 执行增强的代码分析
     * @param document 当前文档
     * @param position 当前位置
     * @param beforeCode 光标前代码
     * @param beforeCursor 光标所在行光标前的代码
     * @param afterCursor 光标所在行光标后的代码
     * @param afterCode 光标后代码
     * @returns 增强的分析结果
     */
    private performEnhancedAnalysis(
        document: vscode.TextDocument,
        position: vscode.Position,
        beforeCode: string,
        beforeCursor: string,
        afterCursor: string,
        afterCode: string
    ): EnhancedAnalysisResult {
        const languageId = document.languageId;
        console.log(afterCode) 
        // 获取或创建特定语言的分析器
        const analyzer = this.getLanguageAnalyzer(languageId);
        
        // 执行基础符号分析
        const relevantSymbols = this.analyzeNearbySymbols(document, position);
        
        // 默认的分析结果
        const result: EnhancedAnalysisResult = {
            relevantSymbols,
            codeStructure: [],
            currentScope: '',
            relatedImports: [],
            syntaxContext: ''
        };
        
        // 使用特定语言分析器增强分析
        if (analyzer) {
            try {
                debug(`使用${languageId}特定分析器进行分析`);
                
                // 分析代码结构
                result.codeStructure = analyzer.analyzeCodeStructure(document, position);
                
                // 分析当前作用域
                result.currentScope = analyzer.analyzeCurrentScope(document, position);
                
                // 分析相关导入
                result.relatedImports = analyzer.analyzeRelatedImports(document, position, relevantSymbols);
                
                // 分析语法上下文
                result.syntaxContext = analyzer.analyzeSyntaxContext(
                    document, 
                    position,
                    beforeCursor, 
                    afterCursor
                );
                
                debug(`${languageId}特定分析完成`);
            } catch (error) {
                log(`语言特定分析错误: ${error}`);
            }
        }
        
        // 执行通用分析以识别代码块和控制结构
        result.codeStructure = [
            ...result.codeStructure,
            ...this.analyzeControlStructures(beforeCode, languageId)
        ];
        
        // 分析当前行的上下文（例如，是否在函数参数中，是否在条件语句中等）
        if (!result.syntaxContext) {
            result.syntaxContext = this.analyzeSyntaxContextGeneric(beforeCursor, afterCursor);
        }
        
        return result;
    }
    
    /**
     * 获取特定语言的分析器
     * @param languageId 语言ID
     * @returns 语言特定的分析器
     */
    private getLanguageAnalyzer(languageId: string): LanguageSpecificAnalyzer | null {
        // 检查缓存
        if (this.languageAnalyzers.has(languageId)) {
            return this.languageAnalyzers.get(languageId) || null;
        }
        
        // 创建新的分析器
        let analyzer: LanguageSpecificAnalyzer | null = null;
        
        switch (languageId) {
            case 'javascript':
            case 'typescript':
            case 'javascriptreact':
            case 'typescriptreact':
                analyzer = new TypeScriptAnalyzer();
                break;
            case 'python':
                analyzer = new PythonAnalyzer();
                break;
            case 'java':
                analyzer = new JavaAnalyzer();
                break;
            // 可以添加更多语言的分析器
            default:
                analyzer = new GenericAnalyzer();
                break;
        }
        
        // 缓存分析器
        this.languageAnalyzers.set(languageId, analyzer);
        return analyzer;
    }
    
    /**
     * 分析控制结构（通用方法）
     * @param code 代码文本
     * @param languageId 语言ID
     * @returns 识别的控制结构
     */
    private analyzeControlStructures(code: string, languageId: string): CodeStructureInfo[] {
        const structures: CodeStructureInfo[] = [];
        
        // 识别常见的控制结构模式
        const patterns: Array<{regex: RegExp, type: string, language?: string[]}> = [
            // 函数定义
            {regex: /function\s+(\w+)\s*\([^)]*\)\s*{/g, type: 'function'},
            {regex: /(\w+)\s*=\s*function\s*\([^)]*\)\s*{/g, type: 'function'},
            {regex: /(\w+)\s*:\s*function\s*\([^)]*\)\s*{/g, type: 'method'},
            {regex: /const\s+(\w+)\s*=\s*\([^)]*\)\s*=>\s*{/g, type: 'arrow-function'},
            {regex: /(\w+)\s*\([^)]*\)\s*{/g, type: 'function'},
            
            // 类定义
            {regex: /class\s+(\w+)(?:\s+extends\s+(\w+))?\s*{/g, type: 'class'},
            
            // 控制结构
            {regex: /if\s*\([^)]*\)\s*{/g, type: 'if-statement'},
            {regex: /else\s*{/g, type: 'else-statement'},
            {regex: /else\s+if\s*\([^)]*\)\s*{/g, type: 'else-if-statement'},
            {regex: /for\s*\([^)]*\)\s*{/g, type: 'for-loop'},
            {regex: /while\s*\([^)]*\)\s*{/g, type: 'while-loop'},
            {regex: /switch\s*\([^)]*\)\s*{/g, type: 'switch-statement'},
            {regex: /case\s+([^:]+):/g, type: 'case-statement'},
            {regex: /try\s*{/g, type: 'try-block'},
            {regex: /catch\s*\([^)]*\)\s*{/g, type: 'catch-block'},
            {regex: /finally\s*{/g, type: 'finally-block'},
            
            // Python特定模式
            {regex: /def\s+(\w+)\s*\([^)]*\):/g, type: 'function', language: ['python']},
            {regex: /class\s+(\w+)(?:\s*\([^)]*\))?:/g, type: 'class', language: ['python']},
            {regex: /if\s+([^:]+):/g, type: 'if-statement', language: ['python']},
            {regex: /elif\s+([^:]+):/g, type: 'elif-statement', language: ['python']},
            {regex: /else:/g, type: 'else-statement', language: ['python']},
            {regex: /for\s+([^:]+):/g, type: 'for-loop', language: ['python']},
            {regex: /while\s+([^:]+):/g, type: 'while-loop', language: ['python']},
            {regex: /try:/g, type: 'try-block', language: ['python']},
            {regex: /except\s*([^:]*)?:/g, type: 'except-block', language: ['python']},
            {regex: /finally:/g, type: 'finally-block', language: ['python']},
            
            // Java特定模式
            {regex: /public\s+(?:class|interface|enum)\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?/g, type: 'class', language: ['java']},
            {regex: /public\s+(?:static\s+)?(?:final\s+)?\w+\s+(\w+)\s*\([^)]*\)\s*{/g, type: 'method', language: ['java']},
            {regex: /private\s+(?:static\s+)?(?:final\s+)?\w+\s+(\w+)\s*\([^)]*\)\s*{/g, type: 'method', language: ['java']},
            {regex: /protected\s+(?:static\s+)?(?:final\s+)?\w+\s+(\w+)\s*\([^)]*\)\s*{/g, type: 'method', language: ['java']}
        ];
        
        // 应用每个模式
        for (const pattern of patterns) {
            // 跳过不适用于当前语言的模式
            if (pattern.language && !pattern.language.includes(languageId)) {
                continue;
            }
            
            let match;
            while ((match = pattern.regex.exec(code)) !== null) {
                const name = match[1] || '';
                structures.push({
                    type: pattern.type,
                    name,
                    position: match.index
                });
            }
        }
        
        // 按位置排序
        return structures.sort((a, b) => a.position - b.position);
    }
    
    /**
     * 通用分析当前语法上下文
     * @param beforeCursor 光标前的文本
     * @param afterCursor 光标后的文本
     * @returns 语法上下文描述
     */
    private analyzeSyntaxContextGeneric(beforeCursor: string, afterCursor: string): string {
        console.log(afterCursor)
        // 检测是否在括号或者引号内部
        const openParens = (beforeCursor.match(/\(/g) || []).length;
        const closeParens = (beforeCursor.match(/\)/g) || []).length;
        const openBraces = (beforeCursor.match(/{/g) || []).length;
        const closeBraces = (beforeCursor.match(/}/g) || []).length;
        const openBrackets = (beforeCursor.match(/\[/g) || []).length;
        const closeBrackets = (beforeCursor.match(/\]/g) || []).length;
        
        // 检查单引号、双引号和反引号
        const singleQuotes = (beforeCursor.match(/'/g) || []).length;
        const doubleQuotes = (beforeCursor.match(/"/g) || []).length;
        const backTicks = (beforeCursor.match(/`/g) || []).length;
        
        // 判断上下文
        if (openParens > closeParens) {
            // 检查是否在函数调用中
            const funcCallMatch = beforeCursor.match(/(\w+)\s*\([^)]*$/);
            if (funcCallMatch) {
                return `在函数 ${funcCallMatch[1]} 的参数列表中`;
            }
            return '在括号内部';
        } else if (openBraces > closeBraces) {
            // 检查是否在对象字面量中
            if (beforeCursor.match(/{[^{]*$/)) {
                return '在对象字面量中';
            }
            return '在代码块内部';
        } else if (openBrackets > closeBrackets) {
            return '在数组字面量中';
        }
        
        // 检查引号情况
        if (singleQuotes % 2 !== 0) {
            return '在单引号字符串中';
        } else if (doubleQuotes % 2 !== 0) {
            return '在双引号字符串中';
        } else if (backTicks % 2 !== 0) {
            return '在模板字符串中';
        }
        
        // 检查是否在赋值语句中
        if (beforeCursor.match(/\w+\s*=\s*$/)) {
            return '在赋值表达式中';
        }
        
        // 检查是否在return语句后
        if (beforeCursor.match(/return\s+$/i)) {
            return '在return语句后';
        }
        
        // 检查是否在条件语句中
        if (beforeCursor.match(/if\s*\(\s*$/i) || beforeCursor.match(/else if\s*\(\s*$/i)) {
            return '在if条件表达式中';
        }
        
        // 默认情况
        return '在常规代码区域';
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
     * 分析附近的符号（变量、函数等），并增强检测
     * @param document 文档
     * @param position 位置
     */
    private analyzeNearbySymbols(document: vscode.TextDocument, position: vscode.Position): string[] {
        const symbols: string[] = [];
        const uniqueSymbols = new Set<string>();
        
        // 扩展符号提取模式，包括更多编程概念
        const symbolRegex = /\b[a-zA-Z_]\w*\b/g;
        const methodCallRegex = /(\w+)\s*\(/g;  // 识别方法调用
        const propertyAccessRegex = /(\w+)\.(\w+)/g;  // 识别属性访问
        
        // 检查周围20行的符号（扩大范围）
        const startLine = Math.max(0, position.line - 20);
        const endLine = Math.min(document.lineCount - 1, position.line + 20);
        
        // 分析当前函数/类范围内的所有符号
        const currentBlockRange = this.getCurrentBlockRange(document, position);
        if (currentBlockRange) {
            for (let i = currentBlockRange.start.line; i <= currentBlockRange.end.line; i++) {
                this.extractSymbolsFromLine(document.lineAt(i).text, document.languageId, uniqueSymbols);
            }
        }
        
        // 分析周围的代码
        for (let i = startLine; i <= endLine; i++) {
            // 给当前行附近的符号更高的优先级
            const distance = Math.abs(i - position.line);
            if (distance <= 5) {  // 5行内的符号是高优先级的
                this.extractSymbolsFromLine(document.lineAt(i).text, document.languageId, uniqueSymbols, true);
            } else {
                this.extractSymbolsFromLine(document.lineAt(i).text, document.languageId, uniqueSymbols);
            }
        }
        
        return Array.from(uniqueSymbols);
    }
    
    /**
     * 获取当前代码块的范围
     * @param document 文档
     * @param position 当前位置
     * @returns 代码块范围或null
     */
    private getCurrentBlockRange(document: vscode.TextDocument, position: vscode.Position): vscode.Range | null {
        const languageId = document.languageId;
        
        // 对于C风格语言（使用花括号表示代码块）
        if (['javascript', 'typescript', 'java', 'c', 'cpp', 'csharp'].includes(languageId)) {
            // 向上查找开始括号
            let openBracePos: vscode.Position | null = null;
            let braceLevel = 0;
            
            // 从当前行向上查找
            for (let line = position.line; line >= 0; line--) {
                const lineText = document.lineAt(line).text;
                
                // 从右到左遍历字符
                for (let char = lineText.length - 1; char >= 0; char--) {
                    if (lineText[char] === '}') {
                        braceLevel++;
                    } else if (lineText[char] === '{') {
                        braceLevel--;
                        if (braceLevel < 0) {
                            openBracePos = new vscode.Position(line, char);
                            break;
                        }
                    }
                }
                
                if (openBracePos) {
                    break;
                }
            }
            
            // 如果找到开始括号，向下查找结束括号
            if (openBracePos) {
                braceLevel = 1;  // 从1开始，因为我们已经找到了一个开括号
                
                for (let line = openBracePos.line; line < document.lineCount; line++) {
                    const lineText = document.lineAt(line).text;
                    
                    // 从左到右遍历字符
                    for (let char = line === openBracePos.line ? openBracePos.character + 1 : 0; char < lineText.length; char++) {
                        if (lineText[char] === '{') {
                            braceLevel++;
                        } else if (lineText[char] === '}') {
                            braceLevel--;
                            if (braceLevel === 0) {
                                return new vscode.Range(openBracePos, new vscode.Position(line, char));
                            }
                        }
                    }
                }
            }
        } 
        // 对于Python（使用缩进表示代码块）
        else if (languageId === 'python') {
            // 获取当前行的缩进级别
            const currentLine = document.lineAt(position.line);
            const currentIndent = this.getIndentationLevel(currentLine.text);
            
            // 向上查找缩进级别小于当前行的行（即当前代码块的起始行）
            let startLine = position.line;
            for (let line = position.line - 1; line >= 0; line--) {
                const lineText = document.lineAt(line).text;
                if (lineText.trim() === '') continue;  // 跳过空行
                
                const indentLevel = this.getIndentationLevel(lineText);
                if (indentLevel < currentIndent) {
                    startLine = line;
                    break;
                }
            }
            
            // 向下查找缩进级别小于等于起始行的行（即当前代码块的结束行）
            const startIndent = this.getIndentationLevel(document.lineAt(startLine).text);
            let endLine = position.line;
            for (let line = position.line + 1; line < document.lineCount; line++) {
                const lineText = document.lineAt(line).text;
                if (lineText.trim() === '') continue;  // 跳过空行
                
                const indentLevel = this.getIndentationLevel(lineText);
                if (indentLevel <= startIndent) {
                    endLine = line - 1;
                    break;
                }
                
                endLine = line;
            }
            
            return new vscode.Range(
                new vscode.Position(startLine, 0),
                new vscode.Position(endLine, document.lineAt(endLine).text.length)
            );
        }
        
        return null;
    }
    
    /**
     * 获取行的缩进级别
     * @param lineText 行文本
     * @returns 缩进级别（空格数）
     */
    private getIndentationLevel(lineText: string): number {
        const match = lineText.match(/^(\s*)/);
        return match ? match[1].length : 0;
    }
    
    /**
     * 从文本行中提取符号
     * @param lineText 行文本
     * @param languageId 语言ID
     * @param symbolSet 符号集合
     * @param isPriority 是否高优先级符号
     */
    private extractSymbolsFromLine(
        lineText: string, 
        languageId: string, 
        symbolSet: Set<string>,
        isPriority: boolean = false
    ): void {
        // 基本符号模式
        const symbolRegex = /\b[a-zA-Z_]\w*\b/g;
        
        // 方法调用模式
        const methodCallRegex = /(\w+)\s*\(/g;
        
        // 属性访问模式
        const propertyAccessRegex = /(\w+)\.(\w+)/g;
        
        // 函数定义模式（语言相关）
        let functionDefRegex = null;
        let classDefRegex = null;
        
        switch (languageId) {
            case 'javascript':
            case 'typescript':
                functionDefRegex = /function\s+(\w+)|(\w+)\s*=\s*function|const\s+(\w+)\s*=\s*\([^)]*\)\s*=>/g;
                classDefRegex = /class\s+(\w+)/g;
                break;
            case 'python':
                functionDefRegex = /def\s+(\w+)/g;
                classDefRegex = /class\s+(\w+)/g;
                break;
            case 'java':
                functionDefRegex = /(?:public|private|protected)(?:\s+static)?\s+\w+\s+(\w+)\s*\(/g;
                classDefRegex = /class\s+(\w+)/g;
                break;
        }
        
        // 提取普通符号
        let match;
        while ((match = symbolRegex.exec(lineText)) !== null) {
            const symbol = match[0];
            // 排除关键字
            if (!this.isKeyword(symbol, languageId)) {
                symbolSet.add(isPriority ? `${symbol}*` : symbol);  // 标记高优先级符号
            }
        }
        
        // 提取方法调用
        while ((match = methodCallRegex.exec(lineText)) !== null) {
            const methodName = match[1];
            if (!this.isKeyword(methodName, languageId)) {
                // 方法调用更重要，添加特殊标记
                symbolSet.add(isPriority ? `${methodName}*()` : `${methodName}()`);
            }
        }
        
        // 提取属性访问
        while ((match = propertyAccessRegex.exec(lineText)) !== null) {
            const objName = match[1];
            const propName = match[2];
            if (!this.isKeyword(objName, languageId) && !this.isKeyword(propName, languageId)) {
                symbolSet.add(isPriority ? `${objName}*` : objName);
                symbolSet.add(isPriority ? `${objName}.${propName}*` : `${objName}.${propName}`);
            }
        }
        
        // 提取函数定义
        if (functionDefRegex) {
            while ((match = functionDefRegex.exec(lineText)) !== null) {
                // 取第一个非undefined的捕获组
                const funcName = match.slice(1).find(g => g !== undefined);
                if (funcName && !this.isKeyword(funcName, languageId)) {
                    // 函数定义很重要，添加特殊标记
                    symbolSet.add(`function:${funcName}`);
                }
            }
        }
        
        // 提取类定义
        if (classDefRegex) {
            while ((match = classDefRegex.exec(lineText)) !== null) {
                const className = match[1];
                if (className && !this.isKeyword(className, languageId)) {
                    // 类定义很重要，添加特殊标记
                    symbolSet.add(`class:${className}`);
                }
            }
        }
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
                    'and', 'or', 'not', 'is', 'in', 'lambda', 'global', 'nonlocal',
                    'async', 'await', 'assert', 'del', 'raise', 'self'
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
                    'void', 'typeof', 'instanceof', 'in', 'of', 'with', 'yield'
                ]);
                break;
                
            case 'java':
                keywords = new Set([
                    'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch',
                    'char', 'class', 'const', 'continue', 'default', 'do', 'double',
                    'else', 'enum', 'extends', 'final', 'finally', 'float', 'for',
                    'if', 'implements', 'import', 'instanceof', 'int', 'interface',
                    'long', 'native', 'new', 'package', 'private', 'protected', 'public',
                    'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized',
                    'this', 'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while',
                    'true', 'false', 'null'
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
            // debug('无法读取package.json:', error);
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