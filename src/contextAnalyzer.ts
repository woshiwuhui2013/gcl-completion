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
  * 优化版 - 更智能地获取上下文
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

        // 获取整个文档内容
        const fullDocumentText = document.getText();
        const totalLines = document.lineCount;

        // 首先尝试获取当前函数或类的范围
        let functionOrClassRange = this.getCurrentFunctionOrClassRange(document, cursorPosition);
        let usedFunctionContext = false;

        // 检查文档长度是否小于1000个字符
        if (fullDocumentText.length < 40000) {
            // 如果整个文档很小，直接使用完整的文档内容作为上下文
            debug('文档较小，使用完整文档作为上下文');

            // 获取文档的所有内容
            const fullBeforeCode = document.getText(new vscode.Range(
                new vscode.Position(0, 0),
                cursorPosition
            ));

            const currentLine = document.lineAt(cursorPosition.line);
            const beforeCursor = currentLine.text.substring(0, cursorPosition.character);
            const afterCursor = currentLine.text.substring(cursorPosition.character);

            const fullAfterCode = document.getText(new vscode.Range(
                cursorPosition,
                new vscode.Position(totalLines - 1, document.lineAt(totalLines - 1).text.length)
            ));

            // 获取当前缩进
            const indentation = this.getIndentation(beforeCursor);
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
                fullBeforeCode,
                beforeCursor,
                afterCursor,
                fullAfterCode
            );

            // 返回上下文信息，包含增强分析结果
            return {
                beforeCode: fullBeforeCode,
                beforeCursor,
                afterCursor,
                afterCode: fullAfterCode,
                indentation,
                expectedIndentation,
                languageId,
                fileName,
                cursorPosition,
                symbolInfo: enhancedContext.relevantSymbols,
                codeStructure: enhancedContext.codeStructure,
                currentScope: enhancedContext.currentScope,
                relatedImports: enhancedContext.relatedImports,
                syntaxContext: enhancedContext.syntaxContext
            };
        }

        // 计算光标前代码的长度
        const beforeCodeLength = document.getText(new vscode.Range(
            new vscode.Position(0, 0),
            cursorPosition
        )).length;

        // 如果光标前代码小于1000个字符，使用全部前置代码
        if (beforeCodeLength < 4000) {
            debug('前置代码较短，使用全部前置代码作为上下文');

            // 获取全部前置代码
            const fullBeforeCode = document.getText(new vscode.Range(
                new vscode.Position(0, 0),
                cursorPosition
            ));

            const currentLine = document.lineAt(cursorPosition.line);
            const beforeCursor = currentLine.text.substring(0, cursorPosition.character);
            const afterCursor = currentLine.text.substring(cursorPosition.character);

            // 对于后置代码，优先使用函数结尾
            let afterCode = '';

            if (functionOrClassRange && functionOrClassRange.end.line >= cursorPosition.line) {
                // 使用函数结尾作为后置代码边界
                afterCode = document.getText(new vscode.Range(
                    cursorPosition,
                    functionOrClassRange.end
                ));
                usedFunctionContext = true;
                debug(`使用函数/类结尾作为后置代码边界: 到第${functionOrClassRange.end.line}行`);
            } else {
                // 如果没有识别到函数/类，使用配置的行数
                const endLine = Math.min(document.lineCount - 1, cursorPosition.line + contextLineCount);
                afterCode = document.getText(new vscode.Range(
                    cursorPosition,
                    new vscode.Position(endLine, document.lineAt(endLine).text.length)
                ));
                debug(`使用配置行数作为后置代码边界: 到第${endLine}行`);
            }

            // 获取当前缩进
            const indentation = this.getIndentation(beforeCursor);
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
                fullBeforeCode,
                beforeCursor,
                afterCursor,
                afterCode
            );

            // 返回上下文信息，包含增强分析结果
            return {
                beforeCode: fullBeforeCode,
                beforeCursor,
                afterCursor,
                afterCode,
                indentation,
                expectedIndentation,
                languageId,
                fileName,
                cursorPosition,
                symbolInfo: enhancedContext.relevantSymbols,
                codeStructure: enhancedContext.codeStructure,
                currentScope: enhancedContext.currentScope,
                relatedImports: enhancedContext.relatedImports,
                syntaxContext: enhancedContext.syntaxContext
            };
        }

        // 检查获取到的函数/类范围是否有效且包含了足够的上下文
        if (functionOrClassRange) {
            // 确保范围在有效行数内
            if (functionOrClassRange.start.line < 0 ||
                functionOrClassRange.end.line >= document.lineCount) {
                debug('函数范围超出文件边界，回退到固定行数方法');
                functionOrClassRange = null;
            }
            // 确保范围包含当前光标位置
            else if (cursorPosition.line < functionOrClassRange.start.line ||
                cursorPosition.line > functionOrClassRange.end.line) {
                debug('光标不在检测到的函数/类范围内，回退到固定行数方法');
                functionOrClassRange = null;
            }
            // 确保范围不是太小
            else if (functionOrClassRange.end.line - functionOrClassRange.start.line < 2) {
                debug('检测到的函数/类范围太小，回退到固定行数方法');
                functionOrClassRange = null;
            }
            else {
                usedFunctionContext = true;
                debug(`使用函数/类范围：从第${functionOrClassRange.start.line}行到第${functionOrClassRange.end.line}行`);
            }
        }

        // 计算上下文范围
        let startLine: number, endLine: number;

        if (functionOrClassRange) {
            // 使用函数或类范围
            startLine = functionOrClassRange.start.line;
            endLine = functionOrClassRange.end.line;
        } else {
            // 回退到使用固定行数方法
            startLine = Math.max(0, cursorPosition.line - contextLineCount);
            endLine = Math.min(document.lineCount - 1, cursorPosition.line + contextLineCount);
            debug(`使用固定行数范围：从第${startLine}行到第${endLine}行`);
        }

        // 获取上文的代码（从起始行到光标所在行的前一行）
        let beforeCode = '';
        for (let i = startLine; i < cursorPosition.line; i++) {
            beforeCode += document.lineAt(i).text + '\n';
        }

        // 获取光标所在行的代码（分为光标前和光标后）
        const currentLine = document.lineAt(cursorPosition.line);
        const beforeCursor = currentLine.text.substring(0, cursorPosition.character);
        const afterCursor = currentLine.text.substring(cursorPosition.character);

        // 获取下文的代码（从光标所在行的下一行到结束行）
        let afterCode = '';
        for (let i = cursorPosition.line + 1; i <= endLine; i++) {
            afterCode += document.lineAt(i).text + '\n';
        }

        // 验证上下文内容
        if (beforeCode.trim() === '') {
            debug('警告：前置代码为空');
        }
        if (afterCode.trim() === '') {
            debug('警告：后置代码为空');
        }

        // 如果前置或后置代码为空且使用了函数/类范围，回退到固定行数方法
        if (usedFunctionContext && (beforeCode.trim() === '' || afterCode.trim() === '')) {
            debug('函数/类范围上下文不完整，回退到固定行数方法');
            // 重新计算使用固定行数
            startLine = Math.max(0, cursorPosition.line - contextLineCount);
            endLine = Math.min(document.lineCount - 1, cursorPosition.line + contextLineCount);

            // 重新获取上文代码
            beforeCode = '';
            for (let i = startLine; i < cursorPosition.line; i++) {
                beforeCode += document.lineAt(i).text + '\n';
            }

            // 重新获取下文代码
            afterCode = '';
            for (let i = cursorPosition.line + 1; i <= endLine; i++) {
                afterCode += document.lineAt(i).text + '\n';
            }
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
            // 增强分析结果
            codeStructure: enhancedContext.codeStructure,
            currentScope: enhancedContext.currentScope,
            relatedImports: enhancedContext.relatedImports,
            syntaxContext: enhancedContext.syntaxContext
        };
    }


    /**
     * 执行增强的代码分析
     * 修改版 - 更好地处理箭头函数和嵌套函数
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
        debug(`执行增强分析，语言: ${languageId}`);

        // 获取或创建特定语言的分析器
        const analyzer = this.getLanguageAnalyzer(languageId);

        // 执行基础符号分析 - 加强符号搜索范围
        const relevantSymbols = this.analyzeNearbySymbols(document, position, beforeCode, afterCode);

        // 默认的分析结果
        const result: EnhancedAnalysisResult = {
            relevantSymbols,
            codeStructure: [],
            currentScope: '',
            relatedImports: [],
            syntaxContext: ''
        };

        // 特别处理JavaScript/TypeScript代码结构
        if (['javascript', 'typescript', 'javascriptreact', 'typescriptreact'].includes(languageId)) {
            // 1. 分析代码结构 - 使用增强的方法识别更多代码结构
            result.codeStructure = this.analyzeJSCodeStructure(document, position, beforeCode, afterCode);

            // 2. 增强分析当前作用域 - 处理嵌套函数/方法
            if (analyzer) {
                try {
                    // 使用特定语言分析器获取作用域
                    result.currentScope = analyzer.analyzeCurrentScope(document, position);
                    debug(`作用域分析结果: ${result.currentScope}`);

                    // 如果作用域分析失败，使用备用方法
                    if (!result.currentScope || result.currentScope === '全局作用域') {
                        result.currentScope = this.analyzeCurrentScopeEnhanced(document, position, beforeCode);
                        debug(`备用作用域分析结果: ${result.currentScope}`);
                    }
                } catch (error) {
                    debug(`作用域分析错误: ${error}`);
                    result.currentScope = '全局作用域';
                }
            }
        } else {
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
        }

        // 通用方法处理其他部分

        // 执行通用分析以识别代码块和控制结构
        if (result.codeStructure.length === 0) {
            result.codeStructure = this.analyzeControlStructures(beforeCode + "\n" + afterCode, languageId);
        }

        // 分析当前行的上下文
        if (!result.syntaxContext) {
            result.syntaxContext = this.analyzeSyntaxContextGeneric(beforeCursor, afterCursor);
        }

        // 分析相关导入
        if (result.relatedImports.length === 0 && analyzer) {
            try {
                result.relatedImports = analyzer.analyzeRelatedImports(document, position, relevantSymbols);
            } catch (error) {
                debug(`导入分析错误: ${error}`);
            }
        }

        // 如果没有找到任何相关导入，尝试使用通用方法
        if (result.relatedImports.length === 0) {
            result.relatedImports = this.analyzeImportsGeneric(beforeCode, languageId);
        }

        return result;
    }
    /**
  * 获取当前光标所在的函数或类的范围
  * 改进版 - 更好地区分函数/类和控制流结构
  * @param document 文档
  * @param position 光标位置
  * @returns 函数或类的范围，如果找不到则返回null
  */
    private getCurrentFunctionOrClassRange(document: vscode.TextDocument, position: vscode.Position): vscode.Range | null {
        const languageId = document.languageId;

        try {
            // 对于TypeScript/JavaScript等使用花括号的语言
            if (['javascript', 'typescript', 'javascriptreact', 'typescriptreact'].includes(languageId)) {
                // debug(`尝试分析 ${languageId} 文件的函数/类结构`);

                // // 1. 首先识别嵌套结构 - 查找包含当前光标的所有嵌套函数/类
                // const nestedScopes = this.findNestedScopes(document, position);
                // if (nestedScopes.length > 0) {
                //     // 使用最内层嵌套函数/方法
                //     const innerMostScope = nestedScopes[nestedScopes.length - 1];
                //     debug(`找到嵌套函数：从第${innerMostScope.start.line}行到第${innerMostScope.end.line}行`);
                //     return innerMostScope;
                // }

                // // 2. 如果嵌套识别失败，尝试传统方法
                // debug('嵌套识别无结果，尝试精确函数识别方法');

                // ========== 更精确的函数定义模式 ==========
                // 明确区分函数定义和控制流语句
                const functionPatterns = [
                    // 标准函数声明
                    /\bfunction\s+(\w+)\s*\(/,
                    // 函数表达式
                    /\b(?:const|let|var)\s+(\w+)\s*=\s*function\s*\(/,
                    /\b(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/,
                    // 对象方法
                    /\b(\w+)\s*[:=]\s*function\s*\(/,
                    /\b(\w+)\s*[:=]\s*(?:async\s*)?\([^)]*\)\s*=>/,
                    // 类方法
                    /\b(?:public|private|protected|static)?\s*(?:async\s*)?\s*(\w+)\s*\([^)]*\)\s*{/,
                    // 导出函数
                    /\bexport\s+(?:default\s+)?function\s+(\w+)\s*\(/,
                    // // 特殊方法识别 - 专门针对inlineCompletionProvider和provideInlineCompletionItems
                    // /\binlineCompletionProvider\s*[=:]\s*function/,
                    // /\bprovideInlineCompletionItems\s*:\s*(?:async\s*)?\(/
                ];

                // ========== 控制流语句模式 ==========
                // 用于排除控制流语句
                const controlFlowPatterns = [
                    /\bif\s*\([^)]*\)/,
                    /\belse\s+if\s*\([^)]*\)/,
                    /\bfor\s*\([^)]*\)/,
                    /\bwhile\s*\([^)]*\)/,
                    /\bswitch\s*\([^)]*\)/,
                    /\bcatch\s*\([^)]*\)/,
                    /\btry\s*{/,
                    /\belse\s*{/,
                    /\bdo\s*{/
                ];

                // 查找最近的函数定义
                const maxLookupLines = 50;  // 搜索范围
                let functionLines: { line: number, text: string, isFunction: boolean }[] = [];

                // 从当前位置向上搜索
                for (let i = 0; i < maxLookupLines && position.line - i >= 0; i++) {
                    const lineNum = position.line - i;
                    const lineText = document.lineAt(lineNum).text;

                    // 首先检查是否是控制流语句
                    let isControlFlow = false;
                    for (const pattern of controlFlowPatterns) {
                        if (pattern.test(lineText)) {
                            isControlFlow = true;
                            break;
                        }
                    }

                    // 如果是控制流语句，跳过
                    if (isControlFlow) {
                        debug(`跳过控制流语句: ${lineText.trim()}`);
                        continue;
                    }

                    // 检查是否是函数定义
                    let isFunction = false;
                    for (const pattern of functionPatterns) {
                        if (pattern.test(lineText)) {
                            isFunction = true;
                            break;
                        }
                    }

                    // 记录可能的函数定义行
                    if (isFunction) {
                        functionLines.push({
                            line: lineNum,
                            text: lineText,
                            isFunction: true
                        });
                        debug(`找到可能的函数定义: ${lineText.trim()}`);
                    }
                }

                // 按照行号排序（从小到大）
                functionLines.sort((a, b) => a.line - b.line);

                // 如果找到了函数定义行
                for (const funcLine of functionLines) {
                    const range = this.getFunctionRangeByLine(document, funcLine.line);
                    if (range && this.positionInRange(position, range)) {
                        debug(`从行 ${funcLine.line} 找到函数范围: ${funcLine.text.trim()}`);
                        return range;
                    }
                }

                // 如果没有找到包含当前位置的函数定义，返回null
                debug('未找到包含当前位置的函数定义');
                return null;
            }
            // 对于Python等其他语言，保持原有逻辑...
            else if (languageId === 'python') {
                // 获取当前行的缩进级别
                const currentLine = document.lineAt(position.line);
                const currentIndent = this.getIndentationLevel(currentLine.text);

                // 向上查找函数或类定义
                let defLine = -1;
                let defIndent = -1;
                const maxLookupLines = 30;  // 增加查找范围

                for (let i = 0; i < maxLookupLines && position.line - i >= 0; i++) {
                    const lineNum = position.line - i;
                    const lineText = document.lineAt(lineNum).text;
                    if (lineText.trim() === '') continue; // 跳过空行

                    const indent = this.getIndentationLevel(lineText);

                    // 尝试查找def或class关键字
                    if (indent < currentIndent || lineNum === position.line) {
                        if (lineText.trim().startsWith('def ') || lineText.trim().startsWith('class ')) {
                            defLine = lineNum;
                            defIndent = indent;
                            debug(`在第${lineNum}行发现Python函数/类定义: ${lineText.trim()}`);
                            break;
                        }
                    }

                    // 如果遇到比当前缩进更小的线，且不是函数或类定义，可能已经跳出当前函数
                    if (indent < currentIndent && i > 0) {
                        break;
                    }
                }

                // 如果找不到函数或类定义，返回null
                if (defLine < 0) {
                    debug('没有找到Python函数或类定义');
                    return null;
                }

                // 找到函数或类定义，确定其范围
                // 向下寻找第一个缩进级别小于等于定义行的非空行
                let endLine = document.lineCount - 1;

                for (let line = defLine + 1; line < document.lineCount; line++) {
                    const lineText = document.lineAt(line).text;
                    if (lineText.trim() === '') continue; // 跳过空行

                    const indent = this.getIndentationLevel(lineText);

                    // 如果找到缩进级别小于等于定义行的非空行，这是函数或类的结束
                    if (indent <= defIndent) {
                        endLine = line - 1;
                        break;
                    }
                }

                // 创建范围，从定义行到确定的结束行
                const range = new vscode.Range(
                    new vscode.Position(defLine, 0),
                    new vscode.Position(endLine, document.lineAt(endLine).text.length)
                );

                debug(`成功找到Python函数/类范围：从第${defLine}行到第${endLine}行`);
                return range;
            }

            // 如果没有找到明确的函数或类，返回null
            return null;
        } catch (error) {
            // 如果发生错误，记录并返回null
            debug(`函数/类范围检测错误: ${error}`);
            return null;
        }
    }

    /**
     * 获取特定行开始的函数范围
     * @param document 文档
     * @param line 函数定义所在行号
     * @returns 函数范围或null
     */
    private getFunctionRangeByLine(document: vscode.TextDocument, line: number): vscode.Range | null {
        try {
            const text = document.getText();
            const lineText = document.lineAt(line).text;

            // 查找开始花括号位置
            let startPos = document.offsetAt(new vscode.Position(line, 0));
            let openBracePos: number | null = null;

            // 先在当前行查找
            const openBraceIndex = lineText.indexOf('{');
            if (openBraceIndex >= 0) {
                openBracePos = startPos + openBraceIndex;
            } else {
                // 向下最多查找5行
                for (let i = 1; i <= 5 && line + i < document.lineCount; i++) {
                    const nextLineText = document.lineAt(line + i).text;
                    const nextLineStart = document.offsetAt(new vscode.Position(line + i, 0));
                    const braceIndex = nextLineText.indexOf('{');

                    if (braceIndex >= 0) {
                        openBracePos = nextLineStart + braceIndex;
                        break;
                    }

                    // 特殊处理箭头函数
                    if (nextLineText.includes('=>')) {
                        const arrowIndex = nextLineText.indexOf('=>');
                        const braceAfterArrow = nextLineText.indexOf('{', arrowIndex);

                        if (braceAfterArrow >= 0) {
                            openBracePos = nextLineStart + braceAfterArrow;
                            break;
                        }
                    }
                }
            }

            // 如果找不到开始花括号，可能是没有块的箭头函数
            if (openBracePos === null) {
                // 检查是否是箭头函数但没有代码块
                if (lineText.includes('=>') && !lineText.includes('{')) {
                    // 对于单行箭头函数，返回这一行作为范围
                    return new vscode.Range(
                        new vscode.Position(line, 0),
                        new vscode.Position(line, lineText.length)
                    );
                }

                // 查找下一行是否有箭头函数
                for (let i = 1; i <= 3 && line + i < document.lineCount; i++) {
                    const nextLineText = document.lineAt(line + i).text;
                    if (nextLineText.includes('=>') && !nextLineText.includes('{')) {
                        // 对于跨行的箭头函数，返回从定义行到箭头行的范围
                        return new vscode.Range(
                            new vscode.Position(line, 0),
                            new vscode.Position(line + i, nextLineText.length)
                        );
                    }
                }

                // 真的找不到任何块标记，返回null
                return null;
            }

            // 找到开始花括号，现在查找匹配的结束花括号
            let braceLevel = 1;
            let endPos: number | null = null;

            for (let i = openBracePos + 1; i < text.length; i++) {
                if (text[i] === '{') {
                    braceLevel++;
                } else if (text[i] === '}') {
                    braceLevel--;

                    if (braceLevel === 0) {
                        endPos = i;
                        break;
                    }
                }
            }

            // 如果找不到匹配的结束花括号，返回null
            if (endPos === null) {
                return null;
            }

            // 返回从函数定义行到结束括号的范围
            return new vscode.Range(
                new vscode.Position(line, 0),
                document.positionAt(endPos + 1) // +1 包含结束括号
            );
        } catch (error) {
            debug(`获取函数范围错误: ${error}`);
            return null;
        }
    }

    /**
     * 查找嵌套的函数和类结构
     * 改进版 - 避免将控制流语句识别为作用域
     * @param document 文档
     * @param position 当前位置
     * @returns 包含当前位置的所有嵌套作用域，从外到内排序
     */
    private findNestedScopes(document: vscode.TextDocument, position: vscode.Position): vscode.Range[] {
        const nestedScopes: vscode.Range[] = [];

        try {
            const text = document.getText();

            // ========== 控制流语句模式 ==========
            // 用于识别并排除控制流语句
            const controlFlowPatterns = [
                /\bif\s*\([^)]*\)\s*{/g,
                /\belse\s+if\s*\([^)]*\)\s*{/g,
                /\belse\s*{/g,
                /\bfor\s*\([^)]*\)\s*{/g,
                /\bwhile\s*\([^)]*\)\s*{/g,
                /\bswitch\s*\([^)]*\)\s*{/g,
                /\btry\s*{/g,
                /\bcatch\s*\([^)]*\)\s*{/g,
                /\bfinally\s*{/g,
                /\bdo\s*{/g
            ];

            // 查找所有控制流语句的位置，稍后排除
            const controlFlowPositions: number[] = [];
            for (const pattern of controlFlowPatterns) {
                let match;
                while ((match = pattern.exec(text)) !== null) {
                    controlFlowPositions.push(match.index);
                }
            }

            // 定义更明确的函数和方法模式
            const scopePatterns = [
                // 外部函数定义
                { pattern: /\bfunction\s+(\w+)\s*\([^)]*\)\s*{/g, type: 'function' },
                { pattern: /\b(?:export\s+(?:default\s+)?)?function\s+(\w+)\s*\([^)]*\)\s*{/g, type: 'function' },

                // 对象/函数表达式
                { pattern: /\b(?:const|let|var)\s+(\w+)\s*=\s*function\s*\([^)]*\)\s*{/g, type: 'function-expression' },
                { pattern: /\b(\w+)\s*[:=]\s*function\s*\([^)]*\)\s*{/g, type: 'method' },

                // 箭头函数 - 特别增强这部分
                { pattern: /\b(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*{/g, type: 'arrow-function' },
                { pattern: /\b(\w+)\s*[:=]\s*(?:async\s*)?\([^)]*\)\s*=>\s*{/g, type: 'arrow-method' },
                { pattern: /\b(\w+)\s*:\s*(?:async\s*)?\([^)]*\)\s*(?::[^{]+)?\s*=>\s*{/g, type: 'interface-method' },

                // 类定义和方法
                { pattern: /\bclass\s+(\w+)(?:\s+extends\s+(\w+))?\s*{/g, type: 'class' },
                { pattern: /\b(?:public|private|protected)?\s*(?:static\s*)?\s*(?:async\s*)?\s*(\w+)\s*\([^)]*\)\s*{/g, type: 'class-method' },

                // 异步函数
                { pattern: /\basync\s+function\s*(\w+)?\s*\([^)]*\)\s*{/g, type: 'async-function' },

                // 特殊方法模式 - 匹配特定的API模式
                { pattern: /provideInlineCompletionItems\s*:\s*(?:async\s*)?\([^)]*\)\s*(?:=>\s*)?{/g, type: 'special-method' },
                { pattern: /inlineCompletionProvider\s*[=:]\s*function\s*\([^)]*\)\s*{/g, type: 'provider-function' }
            ];

            // 查找所有可能的作用域开始位置
            const scopeStarts: { start: number, type: string, name: string }[] = [];

            for (const { pattern, type } of scopePatterns) {
                let match: any;
                while ((match = pattern.exec(text)) !== null) {
                    const name = match[1] || '';

                    // 检查这个位置是否是控制流语句的一部分
                    const isControlFlow = controlFlowPositions.some(pos =>
                        Math.abs(match.index - pos) < 10 // 如果位置非常接近控制流语句，可能是误判
                    );

                    if (!isControlFlow) {
                        scopeStarts.push({
                            start: match.index,
                            type,
                            name
                        });
                    }
                }
            }

            // 按位置排序作用域开始点
            scopeStarts.sort((a, b) => a.start - b.start);

            // 转换文档位置为偏移量
            const positionOffset = document.offsetAt(position);

            // 查找每个作用域的结束位置并检查是否包含当前位置
            for (const scope of scopeStarts) {
                // 从作用域开始位置开始查找匹配的花括号
                let braceLevel = 0;
                let foundOpenBrace = false;
                let openBracePos = -1;

                // 找到开始花括号位置
                for (let i = scope.start; i < Math.min(scope.start + 200, text.length); i++) {
                    if (text[i] === '{') {
                        foundOpenBrace = true;
                        openBracePos = i;
                        braceLevel = 1;
                        break;
                    }
                }

                // 如果找不到开始花括号，跳过这个可能的作用域
                if (!foundOpenBrace) continue;

                // 找到匹配的结束花括号
                let closeBracePos = -1;

                for (let i = openBracePos + 1; i < text.length; i++) {
                    if (text[i] === '{') {
                        braceLevel++;
                    } else if (text[i] === '}') {
                        braceLevel--;

                        if (braceLevel === 0) {
                            closeBracePos = i;
                            break;
                        }
                    }
                }

                // 如果找不到匹配的结束花括号，跳过
                if (closeBracePos === -1) continue;

                // 创建范围对象
                try {
                    const scopeRange = new vscode.Range(
                        document.positionAt(scope.start),
                        document.positionAt(closeBracePos + 1) // +1 包含结束括号
                    );

                    // 检查当前位置是否在此作用域内
                    if (positionOffset > scope.start && positionOffset <= closeBracePos) {
                        debug(`发现包含当前位置的${scope.type} ${scope.name || '(匿名)'}`);
                        nestedScopes.push(scopeRange);
                    }
                } catch (error) {
                    debug(`创建范围对象时出错: ${error}`);
                }
            }

            // 按范围大小排序 - 外层作用域在前，内层嵌套在后
            nestedScopes.sort((a, b) => {
                const aSize = a.end.line - a.start.line;
                const bSize = b.end.line - b.start.line;
                return bSize - aSize; // 降序，大范围在前
            });
        } catch (error) {
            debug(`查找嵌套作用域错误: ${error}`);
        }

        return nestedScopes;
    }

    /**
     * 增强的分析当前作用域方法
     * 特别处理嵌套函数和箭头函数，避免识别控制流结构
     * @param document 文档
     * @param position 当前位置
     * @param beforeCode 光标前代码
     * @returns 当前作用域描述
     */
    private analyzeCurrentScopeEnhanced(document: vscode.TextDocument, position: vscode.Position, beforeCode: string): string {
        try {
            // 定义控制流关键字集合，用于排除
            const controlFlowKeywords = new Set([
                'if', 'else', 'for', 'while', 'switch', 'case',
                'try', 'catch', 'finally', 'do', 'with'
            ]);
            console.log(document.languageId);
            console.log(position);
            // 更明确的作用域定义模式
            const scopePatterns = [
                // 函数声明
                { pattern: /\bfunction\s+(\w+)\s*\(/, type: '函数' },
                // 函数表达式
                { pattern: /\b(?:const|let|var)\s+(\w+)\s*=\s*function\s*\(/, type: '函数' },
                { pattern: /\b(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/, type: '函数' },
                // 方法
                { pattern: /\b(\w+)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>/, type: '方法' },
                { pattern: /\b(\w+)\s*:\s*function\s*\(/, type: '方法' },
                // 类
                { pattern: /\bclass\s+(\w+)/, type: '类' },
                // 导出函数
                { pattern: /\bexport\s+(?:default\s+)?function\s+(\w+)/, type: '函数' },
                // 特殊API模式
                { pattern: /\bprovideInlineCompletionItems\s*:\s*(?:async\s*)?\(/, type: '方法 provideInlineCompletionItems' },
                { pattern: /\binlineCompletionProvider\s*=?\s*function/, type: '函数 inlineCompletionProvider' }
            ];

            // 收集所有匹配的作用域
            const scopes: { type: string, name: string, position: number, raw: string }[] = [];

            // 在前置代码中查找所有可能的作用域
            for (const { pattern, type } of scopePatterns) {
                // 重置正则表达式的lastIndex
                pattern.lastIndex = 0;

                let match;
                while ((match = pattern.exec(beforeCode)) !== null) {
                    // 检查这是否是控制流语句的一部分
                    const isControlFlow = this.isPartOfControlFlow(beforeCode, match.index, controlFlowKeywords);

                    if (!isControlFlow) {
                        // 如果是命名作用域
                        if (match[1]) {
                            scopes.push({
                                type,
                                name: match[1],
                                position: match.index,
                                raw: match[0]
                            });
                        }
                        // 特殊情况：无命名模式但有特定前缀
                        else if (type.includes('provideInlineCompletionItems') || type.includes('inlineCompletionProvider')) {
                            scopes.push({
                                type,
                                name: '',
                                position: match.index,
                                raw: match[0]
                            });
                        }
                    }
                }
            }

            // 按位置排序，最后出现的作用域在最前面（最新的）
            scopes.sort((a, b) => b.position - a.position);

            // 构建嵌套作用域链
            if (scopes.length > 0) {
                let scopeChain = '';
                const uniqueScopes = new Set<string>();

                // 从内到外构建作用域链
                for (const scope of scopes) {
                    const scopeText = scope.name ? `${scope.type} ${scope.name}` : scope.type;

                    // 避免重复的作用域
                    if (!uniqueScopes.has(scopeText)) {
                        if (scopeChain) {
                            scopeChain = `${scopeText} 内 ` + scopeChain;
                        } else {
                            scopeChain = scopeText;
                        }
                        uniqueScopes.add(scopeText);
                    }
                }

                return scopeChain;
            }

            // 如果没有找到作用域
            return '全局作用域';
        } catch (error) {
            debug(`增强作用域分析错误: ${error}`);
            return '全局作用域';
        }
    }

    /**
     * 检查匹配项是否是控制流语句的一部分
     * @param text 文本内容
     * @param position 匹配位置
     * @param controlFlowKeywords 控制流关键字集合
     * @returns 是否是控制流语句的一部分
     */
    private isPartOfControlFlow(text: string, position: number, controlFlowKeywords: Set<string>): boolean {
        // 获取匹配位置之前的50个字符
        const start = Math.max(0, position - 50);
        const textBefore = text.substring(start, position);

        // 检查是否有控制流关键字紧接在匹配项之前
        for (const keyword of controlFlowKeywords) {
            // 创建带单词边界的正则表达式
            const regex = new RegExp(`\\b${keyword}\\b[\\s\\(]*$`);
            if (regex.test(textBefore)) {
                return true;
            }
        }

        return false;
    }


    /**
     * 检查位置是否在范围内
     * @param position 位置
     * @param range 范围
     * @returns 是否在范围内
     */
    private positionInRange(position: vscode.Position, range: vscode.Range): boolean {
        if (position.line < range.start.line || position.line > range.end.line) {
            return false;
        }

        if (position.line === range.start.line && position.character < range.start.character) {
            return false;
        }

        if (position.line === range.end.line && position.character > range.end.character) {
            return false;
        }

        return true;
    }

    /**
     * 从指定位置获取代码块范围
     * @param document 文档
     * @param position 位置
     * @returns 代码块范围或null
     */
    private getBlockRangeFromPosition(document: vscode.TextDocument, position: vscode.Position): vscode.Range | null {
        try {
            const text = document.getText();
            const lineText = document.lineAt(position.line).text;

            // 查找该行或后续行中的开始花括号位置
            let openBracePos: vscode.Position | null = null;
            let openBraceLine = position.line;
            let openBraceFound = false;

            // 在当前行查找
            let openBraceIndex = lineText.indexOf('{');
            if (openBraceIndex >= 0) {
                openBracePos = new vscode.Position(position.line, openBraceIndex);
                openBraceFound = true;
            } else {
                // 向下最多查找5行
                for (let i = 1; i <= 5 && position.line + i < document.lineCount; i++) {
                    const nextLineText = document.lineAt(position.line + i).text;
                    openBraceIndex = nextLineText.indexOf('{');

                    if (openBraceIndex >= 0) {
                        openBracePos = new vscode.Position(position.line + i, openBraceIndex);
                        openBraceLine = position.line + i;
                        openBraceFound = true;
                        break;
                    }

                    // 如果遇到箭头函数但没有花括号，可能是单行箭头函数
                    if (nextLineText.includes('=>') && !nextLineText.includes('{')) {
                        // 返回当前行到下一行的范围
                        return new vscode.Range(
                            position,
                            new vscode.Position(position.line + i, nextLineText.length)
                        );
                    }
                }
            }

            // 如果找不到开始花括号，可能是单行箭头函数，或返回null
            if (!openBraceFound || openBracePos === null) {
                // 检查当前行是否包含单行箭头函数
                if (lineText.includes('=>') && !lineText.includes('{')) {
                    return new vscode.Range(
                        position,
                        new vscode.Position(position.line, lineText.length)
                    );
                }
                return null;
            }

            // ========== 这里是关键修复 ==========
            // 确保 openBracePos 不为 null 后再处理
            if (openBracePos === null) {
                debug('开始花括号位置为null，无法确定代码块范围');
                return null;
            }

            // 找到开始花括号，现在查找匹配的结束花括号
            const startOffset = document.offsetAt(openBracePos);
            let braceLevel = 1;

            for (let i = startOffset + 1; i < text.length; i++) {
                if (text[i] === '{') {
                    braceLevel++;
                } else if (text[i] === '}') {
                    braceLevel--;

                    if (braceLevel === 0) {
                        // 找到匹配的结束括号
                        const endPos = document.positionAt(i);

                        // 返回范围从函数定义所在行开始，到结束括号
                        return new vscode.Range(
                            new vscode.Position(position.line, 0),
                            new vscode.Position(endPos.line, endPos.character + 1)
                        );
                    }
                }
            }

            // 如果没有找到匹配的结束括号，返回到文件末尾的范围
            return new vscode.Range(
                position,
                new vscode.Position(document.lineCount - 1, document.lineAt(document.lineCount - 1).text.length)
            );
        } catch (error) {
            debug(`获取代码块范围错误: ${error}`);
            return null;
        }
    }

    /**
     * 获取最近的代码块
     * 当无法识别具体的函数或类时，尝试找到最近的代码块
     * @param document 文档
     * @param position 位置
     * @returns 代码块范围或null
     */
    private getNearestCodeBlock(document: vscode.TextDocument, position: vscode.Position): vscode.Range | null {
        try {
            // 获取当前行和其缩进
            const currentLine = document.lineAt(position.line);
            const currentIndent = this.getIndentationLevel(currentLine.text);

            // 向上查找可能的代码块开始
            const maxLookupLines = 20;
            let startLine = position.line;
            let blockIndent = currentIndent;

            // 尝试找到相同或更小缩进的上一行
            for (let i = 1; i <= maxLookupLines && position.line - i >= 0; i++) {
                const lineNum = position.line - i;
                const lineText = document.lineAt(lineNum).text.trim();

                // 跳过空行
                if (lineText === '') continue;

                const indent = this.getIndentationLevel(document.lineAt(lineNum).text);

                // 如果找到更小缩进的行，可能是块的开始
                if (indent < blockIndent) {
                    startLine = lineNum;
                    blockIndent = indent;

                    // 如果找到了明显的块开始标记，如{，就停止
                    if (lineText.endsWith('{') || lineText.endsWith(':')) {
                        break;
                    }
                }
            }

            // 向下查找可能的代码块结束
            let endLine = position.line;

            // 尝试找到相同或更小缩进的下一行
            for (let i = 1; i <= maxLookupLines && position.line + i < document.lineCount; i++) {
                const lineNum = position.line + i;
                const lineText = document.lineAt(lineNum).text.trim();

                // 跳过空行
                if (lineText === '') continue;

                const indent = this.getIndentationLevel(document.lineAt(lineNum).text);

                // 如果找到更小缩进的行，可能是块的结束
                if (indent <= blockIndent) {
                    endLine = lineNum - 1;

                    // 如果当前行是明显的块结束（如}），包含它
                    if (lineText === '}' || lineText === 'end') {
                        endLine = lineNum;
                    }

                    break;
                }
            }

            // 如果找不到结束，使用当前行之后的几行
            if (endLine === position.line) {
                endLine = Math.min(document.lineCount - 1, position.line + maxLookupLines / 2);
            }

            // 返回范围，从可能的块开始到结束
            const range = new vscode.Range(
                new vscode.Position(startLine, 0),
                new vscode.Position(endLine, document.lineAt(endLine).text.length)
            );

            debug(`使用代码块范围：从第${startLine}行到第${endLine}行`);
            return range;
        } catch (error) {
            debug(`代码块检测错误: ${error}`);
            return null;
        }
    }



    /**
     * 分析JS/TS代码结构
     * 增强版 - 特别处理TypeScript和箭头函数
     * @param document 文档
     * @param position 位置
     * @param beforeCode 前置代码
     * @param afterCode 后置代码
     * @returns 代码结构信息
     */
    private analyzeJSCodeStructure(
        document: vscode.TextDocument,
        position: vscode.Position,
        beforeCode: string,
        afterCode: string
    ): CodeStructureInfo[] {
        const structures: CodeStructureInfo[] = [];
        const fullCode = beforeCode + "\n" + afterCode;
        console.log(position)
        console.log(document.fileName)
        // 增强的模式定义
        const patterns = [
            // 基本函数
            { regex: /function\s+(\w+)\s*\([^)]*\)/g, type: 'function' },
            { regex: /(\w+)\s*=\s*function\s*\([^)]*\)/g, type: 'function' },
            { regex: /(\w+)\s*:\s*function\s*\([^)]*\)/g, type: 'method' },

            // 箭头函数 - 强化这部分
            { regex: /const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g, type: 'arrow-function' },
            { regex: /let\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g, type: 'arrow-function' },
            { regex: /var\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g, type: 'arrow-function' },
            { regex: /(\w+)\s*:\s*(?:async\s*)?\([^)]*\)\s*=>/g, type: 'arrow-method' },

            // 类定义
            { regex: /class\s+(\w+)(?:\s+extends\s+(\w+))?\s*{/g, type: 'class' },

            // TypeScript特有
            { regex: /interface\s+(\w+)(?:\s+extends\s+([^{]+))?\s*{/g, type: 'interface' },
            { regex: /type\s+(\w+)\s*=\s*{/g, type: 'type' },
            { regex: /enum\s+(\w+)\s*{/g, type: 'enum' },

            // 导入/导出
            { regex: /import\s+(\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g, type: 'import' },
            { regex: /export\s+(?:default\s+)?function\s+(\w+)/g, type: 'exported-function' },
            { regex: /export\s+(?:default\s+)?class\s+(\w+)/g, type: 'exported-class' },

            // 特殊模式 - 识别常见API
            { regex: /provideInlineCompletionItems\s*:\s*(?:async\s*)?\([^)]*\)/g, type: 'api-method' },
            { regex: /inlineCompletionProvider\s*[=:]\s*function/g, type: 'api-function' }
        ];

        // 查找所有匹配
        for (const { regex, type } of patterns) {
            let match;
            while ((match = regex.exec(fullCode)) !== null) {
                const name = match[1] || (type.includes('api') ? type.split('-')[1] : '');
                structures.push({
                    type,
                    name,
                    position: match.index
                });
            }
        }

        // 按位置排序
        return structures.sort((a, b) => a.position - b.position);
    }

    /**
  * 分析附近的符号（变量、函数等）- 增强版
  * @param document 文档
  * @param position 位置
  * @param beforeCode 前置代码
  * @param afterCode 后置代码
  * @returns 相关符号数组
  */
    private analyzeNearbySymbols(
        document: vscode.TextDocument,
        position: vscode.Position,
        beforeCode: string = '',
        afterCode: string = ''
    ): string[] {
        const uniqueSymbols = new Set<string>();
        const languageId = document.languageId;

        try {
            // 如果提供了前置和后置代码，直接分析它们
            if (beforeCode || afterCode) {
                this.extractSymbolsFromText(beforeCode, languageId, uniqueSymbols, true);
                this.extractSymbolsFromText(afterCode, languageId, uniqueSymbols);
            } else {
                // 扩展符号提取模式，包括更多编程概念
                const symbolRegex = /\b[a-zA-Z_]\w*\b/g;
                const methodCallRegex = /(\w+)\s*\(/g;  // 识别方法调用
                const propertyAccessRegex = /(\w+)\.(\w+)/g;  // 识别属性访问

                // 检查周围20行的符号（扩大范围）
                const startLine = Math.max(0, position.line - 30);
                const endLine = Math.min(document.lineCount - 1, position.line + 30);

                // 分析当前函数/类范围内的所有符号
                const currentBlockRange = this.getCurrentFunctionOrClassRange(document, position);
                if (currentBlockRange) {
                    for (let i = currentBlockRange.start.line; i <= currentBlockRange.end.line; i++) {
                        this.extractSymbolsFromLine(document.lineAt(i).text, languageId, uniqueSymbols);
                    }
                }

                // 分析周围的代码
                for (let i = startLine; i <= endLine; i++) {
                    // 给当前行附近的符号更高的优先级
                    const distance = Math.abs(i - position.line);
                    if (distance <= 8) {  // 8行内的符号是高优先级的
                        this.extractSymbolsFromLine(document.lineAt(i).text, languageId, uniqueSymbols, true);
                    } else {
                        this.extractSymbolsFromLine(document.lineAt(i).text, languageId, uniqueSymbols);
                    }
                }
            }
        } catch (error) {
            debug(`分析符号时出错: ${error}`);
        }

        // 转换为数组并返回
        return Array.from(uniqueSymbols);
    }



    /**
     * 从文本中提取符号
     * @param text 文本内容
     * @param languageId 语言ID
     * @param symbolSet 符号集合
     * @param isPriority 是否高优先级
     */
    private extractSymbolsFromText(
        text: string,
        languageId: string,
        symbolSet: Set<string>,
        isPriority: boolean = false
    ): void {
        // 按行分割文本
        const lines = text.split('\n');

        // 处理每一行
        for (const line of lines) {
            this.extractSymbolsFromLine(line, languageId, symbolSet, isPriority);
        }

        // 特殊处理：查找API特定标识符
        const apiPatterns = [
            /provideInlineCompletionItems/g,
            /inlineCompletionProvider/g,
            /getCodeCompletions\(/g,
            /trie\.getPrefix\(/g,
            /updateStatusBarItem\(/g,
            /candidateNum/g,
            /someTrackingIdCounter/g,
            /lastRequest/g
        ];

        for (const pattern of apiPatterns) {
            if (pattern.test(text)) {
                const match = pattern.toString().match(/\w+/);
                if (match) {
                    symbolSet.add(match[0] + '*');  // 标记为高优先级
                    symbolSet.add(match[0] + '*()');  // 添加函数调用形式
                }
            }
        }

        // 增强函数参数识别 - 针对provideInlineCompletionItems方法
        const functionParamMatch = text.match(/provideInlineCompletionItems\s*:\s*async\s*\(\s*([^)]+)\)/);
        if (functionParamMatch && functionParamMatch[1]) {
            const params = functionParamMatch[1].split(',').map(p => p.trim());

            for (const param of params) {
                const paramName = param.split(':')[0].trim();
                if (paramName && !this.isKeyword(paramName, languageId)) {
                    symbolSet.add(paramName + '*');  // 标记参数为高优先级
                }
            }
        }
    }

    /**
     * 通用导入分析
     * @param code 代码文本
     * @param languageId 语言ID
     * @returns 导入语句数组
     */
    private analyzeImportsGeneric(code: string, languageId: string): string[] {
        const imports: string[] = [];

        // 针对不同语言的导入模式
        if (['javascript', 'typescript', 'javascriptreact', 'typescriptreact'].includes(languageId)) {
            // JS/TS导入模式
            const importPattern = /import\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g;
            let match;

            while ((match = importPattern.exec(code)) !== null) {
                const importStatement = match[0];
                imports.push(importStatement);
            }
        } else if (languageId === 'python') {
            // Python导入模式
            const importPatterns = [
                /import\s+(\w+)(?:\s+as\s+(\w+))?/g,
                /from\s+([\w.]+)\s+import\s+([^#\n]+)/g
            ];

            for (const pattern of importPatterns) {
                let match;
                while ((match = pattern.exec(code)) !== null) {
                    imports.push(match[0]);
                }
            }
        } else {
            // 通用导入模式（适用于其他语言）
            const genericImportPatterns = [
                /import\s+[^;]+;/g,          // C++, Java风格
                /#include\s*[<"][^>"]+[>"]/g, // C/C++风格
                /using\s+[^;]+;/g             // C#风格
            ];

            for (const pattern of genericImportPatterns) {
                let match;
                while ((match = pattern.exec(code)) !== null) {
                    imports.push(match[0]);
                }
            }
        }

        // 为TS/JS添加常见导入
        if (['javascript', 'typescript'].includes(languageId) && code.includes('vscode')) {
            if (!imports.some(imp => imp.includes('vscode'))) {
                imports.push('import * as vscode from \'vscode\'');
            }
        }

        return imports;
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

        // 识别函数参数 - 特别处理
        const paramPatterns = [
            /function\s*\(([^)]*)\)/,
            /\([^)]*\)\s*=>/,
            /\(([^)]*)\)\s*{/
        ];

        for (const pattern of paramPatterns) {
            const paramMatch = lineText.match(pattern);
            if (paramMatch && paramMatch[1]) {
                const params = paramMatch[1].split(',').map(p => p.trim());

                for (const param of params) {
                    // 提取参数名（忽略类型注解和默认值）
                    const paramName = param.split(/[=:]/, 2)[0].trim();
                    if (paramName && !this.isKeyword(paramName, languageId)) {
                        symbolSet.add(isPriority ? `${paramName}*` : paramName);
                    }
                }
            }
        }
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
        const patterns: Array<{ regex: RegExp, type: string, language?: string[] }> = [
            // 函数定义
            { regex: /function\s+(\w+)\s*\([^)]*\)\s*{/g, type: 'function' },
            { regex: /(\w+)\s*=\s*function\s*\([^)]*\)\s*{/g, type: 'function' },
            { regex: /(\w+)\s*:\s*function\s*\([^)]*\)\s*{/g, type: 'method' },
            { regex: /const\s+(\w+)\s*=\s*\([^)]*\)\s*=>\s*{/g, type: 'arrow-function' },
            { regex: /(\w+)\s*\([^)]*\)\s*{/g, type: 'function' },

            // 类定义
            { regex: /class\s+(\w+)(?:\s+extends\s+(\w+))?\s*{/g, type: 'class' },

            // 控制结构
            { regex: /if\s*\([^)]*\)\s*{/g, type: 'if-statement' },
            { regex: /else\s*{/g, type: 'else-statement' },
            { regex: /else\s+if\s*\([^)]*\)\s*{/g, type: 'else-if-statement' },
            { regex: /for\s*\([^)]*\)\s*{/g, type: 'for-loop' },
            { regex: /while\s*\([^)]*\)\s*{/g, type: 'while-loop' },
            { regex: /switch\s*\([^)]*\)\s*{/g, type: 'switch-statement' },
            { regex: /case\s+([^:]+):/g, type: 'case-statement' },
            { regex: /try\s*{/g, type: 'try-block' },
            { regex: /catch\s*\([^)]*\)\s*{/g, type: 'catch-block' },
            { regex: /finally\s*{/g, type: 'finally-block' },

            // Python特定模式
            { regex: /def\s+(\w+)\s*\([^)]*\):/g, type: 'function', language: ['python'] },
            { regex: /class\s+(\w+)(?:\s*\([^)]*\))?:/g, type: 'class', language: ['python'] },
            { regex: /if\s+([^:]+):/g, type: 'if-statement', language: ['python'] },
            { regex: /elif\s+([^:]+):/g, type: 'elif-statement', language: ['python'] },
            { regex: /else:/g, type: 'else-statement', language: ['python'] },
            { regex: /for\s+([^:]+):/g, type: 'for-loop', language: ['python'] },
            { regex: /while\s+([^:]+):/g, type: 'while-loop', language: ['python'] },
            { regex: /try:/g, type: 'try-block', language: ['python'] },
            { regex: /except\s*([^:]*)?:/g, type: 'except-block', language: ['python'] },
            { regex: /finally:/g, type: 'finally-block', language: ['python'] },

            // Java特定模式
            { regex: /public\s+(?:class|interface|enum)\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?/g, type: 'class', language: ['java'] },
            { regex: /public\s+(?:static\s+)?(?:final\s+)?\w+\s+(\w+)\s*\([^)]*\)\s*{/g, type: 'method', language: ['java'] },
            { regex: /private\s+(?:static\s+)?(?:final\s+)?\w+\s+(\w+)\s*\([^)]*\)\s*{/g, type: 'method', language: ['java'] },
            { regex: /protected\s+(?:static\s+)?(?:final\s+)?\w+\s+(\w+)\s*\([^)]*\)\s*{/g, type: 'method', language: ['java'] }
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
     * 获取当前位置的缩进
     * @param lineText 行文本
     * @returns 缩进字符串
     */
    private getIndentation(lineText: string): string {
        const match = lineText.match(/^(\s*)/);
        return match ? match[1] : '';
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