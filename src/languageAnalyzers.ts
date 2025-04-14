import * as vscode from 'vscode';
import { log, debug } from './utils';

/**
 * 语言特定分析器接口
 * 定义不同语言分析器需要实现的方法
 */
interface LanguageSpecificAnalyzer {
    /**
     * 分析代码结构
     * @param document 当前文档
     * @param position 当前位置
     * @returns 代码结构信息
     */
    analyzeCodeStructure(document: vscode.TextDocument, position: vscode.Position): CodeStructureInfo[];
    
    /**
     * 分析当前作用域
     * @param document 当前文档
     * @param position 当前位置
     * @returns 当前作用域描述
     */
    analyzeCurrentScope(document: vscode.TextDocument, position: vscode.Position): string;
    
    /**
     * 分析相关导入
     * @param document 当前文档
     * @param position 当前位置
     * @param symbols 相关符号
     * @returns 相关导入信息
     */
    analyzeRelatedImports(document: vscode.TextDocument, position: vscode.Position, symbols: string[]): string[];
    
    /**
     * 分析语法上下文
     * @param document 当前文档
     * @param position 当前位置
     * @param beforeCursor 光标前的文本
     * @param afterCursor 光标后的文本
     * @returns 语法上下文描述
     */
    analyzeSyntaxContext(
        document: vscode.TextDocument, 
        position: vscode.Position,
        beforeCursor: string, 
        afterCursor: string
    ): string;
}

/**
 * 代码结构信息接口
 */
interface CodeStructureInfo {
    type: string;        // 类型: class, function, method, if-statement, etc.
    name: string;        // 名称(如果有)
    position: number;    // 在代码中的位置索引
}

/**
 * 增强分析结果接口
 */
interface EnhancedAnalysisResult {
    relevantSymbols: string[];       // 相关符号
    codeStructure: CodeStructureInfo[]; // 代码结构
    currentScope: string;            // 当前作用域
    relatedImports: string[];        // 相关导入
    syntaxContext: string;           // 语法上下文
}

/**
 * TypeScript/JavaScript 代码分析器
 */
class TypeScriptAnalyzer implements LanguageSpecificAnalyzer {
    /**
     * 分析代码结构
     * @param document 当前文档
     * @param position 当前位置
     */
    public analyzeCodeStructure(document: vscode.TextDocument, position: vscode.Position): CodeStructureInfo[] {
        console.log(position)
        const structures: CodeStructureInfo[] = [];
        const text = document.getText();
        
        // 函数定义模式
        const functionPatterns = [
            { regex: /function\s+(\w+)\s*\([^)]*\)\s*{/g, type: 'function' },
            { regex: /const\s+(\w+)\s*=\s*function\s*\([^)]*\)\s*{/g, type: 'function' },
            { regex: /const\s+(\w+)\s*=\s*\([^)]*\)\s*=>\s*{/g, type: 'arrow-function' },
            { regex: /(\w+)\s*=\s*\([^)]*\)\s*=>\s*{/g, type: 'arrow-function' },
            { regex: /(\w+)\s*:\s*function\s*\([^)]*\)\s*{/g, type: 'method' }
        ];
        
        // 类定义模式
        const classPattern = /class\s+(\w+)(?:\s+extends\s+(\w+))?\s*{/g;
        
        // 接口定义模式 (TypeScript)
        const interfacePattern = /interface\s+(\w+)(?:\s+extends\s+([^{]+))?\s*{/g;
        
        // 模块导入模式
        const importPattern = /import\s+(\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([@\w\/-]+)['"]/g;
        
        // 提取函数
        for (const pattern of functionPatterns) {
            let match;
            while ((match = pattern.regex.exec(text)) !== null) {
                structures.push({
                    type: pattern.type,
                    name: match[1] || '',
                    position: match.index
                });
            }
        }
        
        // 提取类
        let match;
        while ((match = classPattern.exec(text)) !== null) {
            structures.push({
                type: 'class',
                name: match[1] || '',
                position: match.index
            });
        }
        
        // 提取接口
        while ((match = interfacePattern.exec(text)) !== null) {
            structures.push({
                type: 'interface',
                name: match[1] || '',
                position: match.index
            });
        }
        
        // 提取导入
        while ((match = importPattern.exec(text)) !== null) {
            structures.push({
                type: 'import',
                name: match[2] || '',
                position: match.index
            });
        }
        
        return structures.sort((a, b) => a.position - b.position);
    }
    
    /**
     * 分析当前作用域
     * @param document 当前文档
     * @param position 当前位置
     */
    public analyzeCurrentScope(document: vscode.TextDocument, position: vscode.Position): string {
        const text = document.getText();
        const offset = document.offsetAt(position);
        
        // 查找当前位置所在的函数或类
        let currentFunction = '';
        let currentClass = '';
        
        // 函数模式
        const functionPatterns = [
            { regex: /function\s+(\w+)\s*\([^)]*\)\s*{/g, type: 'function' },
            { regex: /const\s+(\w+)\s*=\s*function\s*\([^)]*\)\s*{/g, type: 'function' },
            { regex: /const\s+(\w+)\s*=\s*\([^)]*\)\s*=>\s*{/g, type: 'arrow-function' },
            { regex: /(\w+)\s*=\s*\([^)]*\)\s*=>\s*{/g, type: 'arrow-function' },
            { regex: /(\w+)\s*:\s*function\s*\([^)]*\)\s*{/g, type: 'method' }
        ];
        
        // 类模式
        const classPattern = /class\s+(\w+)(?:\s+extends\s+(\w+))?\s*{/g;
        
        // 查找函数
        for (const pattern of functionPatterns) {
            let match;
            while ((match = pattern.regex.exec(text)) !== null) {
                const start = match.index;
                // 粗略估计函数的结束位置，查找匹配的闭花括号
                let braceCount = 1;
                let end = start;
                
                for (let i = start + match[0].indexOf('{') + 1; i < text.length; i++) {
                    if (text[i] === '{') braceCount++;
                    else if (text[i] === '}') braceCount--;
                    
                    if (braceCount === 0) {
                        end = i;
                        break;
                    }
                }
                
                // 检查当前位置是否在这个函数内
                if (offset > start && offset < end) {
                    currentFunction = match[1] || '';
                }
            }
        }
        
        // 查找类
        let match;
        while ((match = classPattern.exec(text)) !== null) {
            const start = match.index;
            // 粗略估计类的结束位置
            let braceCount = 1;
            let end = start;
            
            for (let i = start + match[0].indexOf('{') + 1; i < text.length; i++) {
                if (text[i] === '{') braceCount++;
                else if (text[i] === '}') braceCount--;
                
                if (braceCount === 0) {
                    end = i;
                    break;
                }
            }
            
            // 检查当前位置是否在这个类内
            if (offset > start && offset < end) {
                currentClass = match[1] || '';
            }
        }
        
        // 返回作用域描述
        if (currentClass && currentFunction) {
            return `类 ${currentClass} 的方法 ${currentFunction} 内`;
        } else if (currentClass) {
            return `类 ${currentClass} 内`;
        } else if (currentFunction) {
            return `函数 ${currentFunction} 内`;
        } else {
            return '全局作用域';
        }
    }
    
    /**
     * 分析相关导入
     * @param document 当前文档
     * @param position 当前位置
     * @param symbols 相关符号
     */
    public analyzeRelatedImports(document: vscode.TextDocument, position: vscode.Position, symbols: string[]): string[] {
        console.log(position)
        const imports: string[] = [];
        const text = document.getText();
        
        // 导入模式
        const importPattern = /import\s+(?:(\{[^}]+\})|\*\s+as\s+(\w+)|(\w+))\s+from\s+['"]([@\w\/-]+)['"]/g;
        
        // 提取所有导入语句
        let match;
        while ((match = importPattern.exec(text)) !== null) {
            const importClause = match[1] || match[2] || match[3] || '';
            const moduleName = match[4] || '';
            
            // 检查是否有任何相关符号在这个导入语句中
            if (importClause.includes('{')) {
                // 处理命名导入
                const namedImports = importClause.replace(/[{}\s]/g, '').split(',');
                
                for (const symbol of symbols) {
                    const plainSymbol = symbol.replace(/[*()]/g, ''); // 移除标记
                    
                    for (const namedImport of namedImports) {
                        // 处理导入别名
                        const [importName, alias] = namedImport.split(' as ');
                        
                        if (plainSymbol === importName || plainSymbol === alias) {
                            imports.push(`import { ${namedImport} } from '${moduleName}'`);
                            break;
                        }
                    }
                }
            } else if (match[2]) {
                // 处理命名空间导入
                const namespace = match[2];
                
                for (const symbol of symbols) {
                    const plainSymbol = symbol.replace(/[*()]/g, ''); // 移除标记
                    
                    if (plainSymbol.startsWith(`${namespace}.`)) {
                        imports.push(`import * as ${namespace} from '${moduleName}'`);
                        break;
                    }
                }
            } else if (match[3]) {
                // 处理默认导入
                const defaultImport = match[3];
                
                for (const symbol of symbols) {
                    const plainSymbol = symbol.replace(/[*()]/g, ''); // 移除标记
                    
                    if (plainSymbol === defaultImport) {
                        imports.push(`import ${defaultImport} from '${moduleName}'`);
                        break;
                    }
                }
            }
        }
        
        return imports;
    }
    
    /**
     * 分析语法上下文
     * @param document 当前文档
     * @param position 当前位置
     * @param beforeCursor 光标前的文本
     * @param afterCursor 光标后的文本
     */
    public analyzeSyntaxContext(
        document: vscode.TextDocument, 
        position: vscode.Position,
        beforeCursor: string, 
        afterCursor: string
    ): string {
        // 分析是否在特殊语法结构内
        console.log(position)
        // JSX 分析
        if (document.languageId === 'typescriptreact' || document.languageId === 'javascriptreact') {
            // 检查是否在JSX标签内
            const jsxOpenTagRegex = /<(\w+)([^>]*)$/;
            const jsxCloseTagRegex = /<\/(\w+)>$/;
            
            const openMatch = beforeCursor.match(jsxOpenTagRegex);
            if (openMatch) {
                return `在JSX ${openMatch[1]} 标签内`;
            }
            
            const closeMatch = beforeCursor.match(jsxCloseTagRegex);
            if (closeMatch) {
                return `在JSX ${closeMatch[1]} 标签后`;
            }
            
            // 检查是否在JSX表达式内
            if (beforeCursor.includes('{') && !afterCursor.includes('}')) {
                return '在JSX表达式内';
            }
        }
        
        // TypeScript 类型注解分析
        if (document.languageId === 'typescript' || document.languageId === 'typescriptreact') {
            if (beforeCursor.includes(':') && !beforeCursor.includes(';') && !beforeCursor.includes('?') && !beforeCursor.includes(',')) {
                return '在TypeScript类型注解内';
            }
        }
        
        // 分析是否在特定语法结构内
        // 函数参数列表
        if (beforeCursor.match(/\(\s*$/) || (beforeCursor.includes('(') && !afterCursor.includes(')'))) {
            // 查找最近的函数调用
            const funcCallMatch = beforeCursor.match(/(\w+)\s*\([^)]*$/);
            if (funcCallMatch) {
                return `在函数 ${funcCallMatch[1]} 的参数列表中`;
            }
            return '在函数参数列表中';
        }
        
        // 对象字面量
        if (beforeCursor.match(/{\s*$/) || (beforeCursor.includes('{') && !afterCursor.includes('}'))) {
            // 判断是否是对象字面量还是代码块
            const objLiteralPattern = /=\s*{\s*$/;
            if (beforeCursor.match(objLiteralPattern)) {
                return '在对象字面量中';
            }
        }
        
        // 数组字面量
        if (beforeCursor.match(/\[\s*$/) || (beforeCursor.includes('[') && !afterCursor.includes(']'))) {
            return '在数组字面量中';
        }
        
        // 模板字符串
        if ((beforeCursor.match(/`[^`]*$/) && !afterCursor.includes('`'))) {
            return '在模板字符串中';
        }
        
        // 字符串
        if ((beforeCursor.match(/'[^']*$/) && !afterCursor.includes("'")) || 
            (beforeCursor.match(/"[^"]*$/) && !afterCursor.includes('"'))) {
            return '在字符串中';
        }
        
        // 默认，使用通用分析
        return '';
    }
}

/**
 * Python 代码分析器
 */
class PythonAnalyzer implements LanguageSpecificAnalyzer {
    /**
     * 分析代码结构
     * @param document 当前文档
     * @param position 当前位置
     */
    public analyzeCodeStructure(document: vscode.TextDocument, position: vscode.Position): CodeStructureInfo[] {
        const structures: CodeStructureInfo[] = [];
        const text = document.getText();
        console.log(position)
        // 函数定义模式
        const functionPattern = /def\s+(\w+)\s*\([^)]*\):/g;
        
        // 类定义模式
        const classPattern = /class\s+(\w+)(?:\s*\([^)]*\))?:/g;
        
        // 导入模式
        const importPatterns = [
            { regex: /import\s+(\w+)(?:\s+as\s+(\w+))?/g, type: 'import' },
            { regex: /from\s+([\w.]+)\s+import\s+([^#\n]+)/g, type: 'import-from' }
        ];
        
        // 提取函数
        let match;
        while ((match = functionPattern.exec(text)) !== null) {
            structures.push({
                type: 'function',
                name: match[1] || '',
                position: match.index
            });
        }
        
        // 提取类
        while ((match = classPattern.exec(text)) !== null) {
            structures.push({
                type: 'class',
                name: match[1] || '',
                position: match.index
            });
        }
        
        // 提取导入
        for (const pattern of importPatterns) {
            while ((match = pattern.regex.exec(text)) !== null) {
                structures.push({
                    type: pattern.type,
                    name: (pattern.type === 'import' ? match[1] : match[2]) || '',
                    position: match.index
                });
            }
        }
        
        return structures.sort((a, b) => a.position - b.position);
    }
    
    /**
     * 分析当前作用域
     * @param document 当前文档
     * @param position 当前位置
     */
    public analyzeCurrentScope(document: vscode.TextDocument, position: vscode.Position): string {
        // 分析Python的缩进层级来确定当前作用域
        const currentLine = document.lineAt(position.line);
        const currentIndent = currentLine.text.match(/^\s*/)?.[0].length || 0;
        
        // 向上查找当前缩进级别之上的定义
        let functionName = '';
        let className = '';
        
        for (let line = position.line - 1; line >= 0; line--) {
            const lineText = document.lineAt(line).text;
            const lineIndent = lineText.match(/^\s*/)?.[0].length || 0;
            
            // 如果找到一个缩进级别小于当前的行
            if (lineIndent < currentIndent) {
                // 检查是否是函数定义
                const functionMatch = lineText.match(/^\s*def\s+(\w+)/);
                if (functionMatch && !functionName) {
                    functionName = functionMatch[1];
                }
                
                // 检查是否是类定义
                const classMatch = lineText.match(/^\s*class\s+(\w+)/);
                if (classMatch && !className) {
                    className = classMatch[1];
                }
                
                // 如果已经找到了函数和类，或者到达了文件顶层，就停止
                if ((functionName && className) || lineIndent === 0) {
                    break;
                }
            }
        }
        
        // 返回作用域描述
        if (className && functionName) {
            return `类 ${className} 的方法 ${functionName} 内`;
        } else if (className) {
            return `类 ${className} 内`;
        } else if (functionName) {
            return `函数 ${functionName} 内`;
        } else {
            return '全局作用域';
        }
    }
    
    /**
     * 分析相关导入
     * @param document 当前文档
     * @param position 当前位置
     * @param symbols 相关符号
     */
    public analyzeRelatedImports(document: vscode.TextDocument, position: vscode.Position, symbols: string[]): string[] {
        console.log(position)
        const imports: string[] = [];
        const text = document.getText();
        
        // 直接导入模式
        const importPattern = /import\s+(\w+)(?:\s+as\s+(\w+))?/g;
        
        // from-import模式
        const fromImportPattern = /from\s+([\w.]+)\s+import\s+([^#\n]+)/g;
        
        // 处理直接导入
        let match;
        while ((match = importPattern.exec(text)) !== null) {
            const moduleName = match[1];
            const alias = match[2] || moduleName;
            
            for (const symbol of symbols) {
                const plainSymbol = symbol.replace(/[*()]/g, ''); // 移除标记
                
                if (plainSymbol === alias || plainSymbol.startsWith(`${alias}.`)) {
                    imports.push(`import ${moduleName}${alias !== moduleName ? ` as ${alias}` : ''}`);
                    break;
                }
            }
        }
        
        // 处理from-import
        while ((match = fromImportPattern.exec(text)) !== null) {
            const moduleName = match[1];
            const importItems = match[2].split(',').map(item => item.trim());
            
            for (const importItem of importItems) {
                const [name, alias] = importItem.split(' as ').map(item => item.trim());
                const importName = alias || name;
                
                for (const symbol of symbols) {
                    const plainSymbol = symbol.replace(/[*()]/g, ''); // 移除标记
                    
                    if (plainSymbol === importName) {
                        imports.push(`from ${moduleName} import ${importItem}`);
                        break;
                    }
                }
            }
        }
        
        return imports;
    }
    
    /**
     * 分析语法上下文
     * @param document 当前文档
     * @param position 当前位置
     * @param beforeCursor 光标前的文本
     * @param afterCursor 光标后的文本
     */
    public analyzeSyntaxContext(
        document: vscode.TextDocument, 
        position: vscode.Position,
        beforeCursor: string, 
        afterCursor: string
    ): string {
        // 分析是否在特殊语法结构内
        console.log(position)
        console.log(document)

        // 检查是否在函数参数列表内
        if (beforeCursor.match(/\(\s*$/) || (beforeCursor.includes('(') && !afterCursor.includes(')'))) {
            const funcMatch = beforeCursor.match(/(\w+)\s*\([^)]*$/);
            if (funcMatch) {
                return `在函数 ${funcMatch[1]} 的参数列表中`;
            }
            return '在函数参数列表中';
        }
        
        // 检查是否在列表或元组内
        if (beforeCursor.match(/\[\s*$/) || (beforeCursor.includes('[') && !afterCursor.includes(']'))) {
            return '在列表中';
        }
        
        // 检查是否在字典内
        if (beforeCursor.match(/{\s*$/) || (beforeCursor.includes('{') && !afterCursor.includes('}'))) {
            return '在字典中';
        }
        
        // 检查是否在字符串内
        if ((beforeCursor.match(/'[^']*$/) && !afterCursor.includes("'")) || 
            (beforeCursor.match(/"[^"]*$/) && !afterCursor.includes('"'))) {
            return '在字符串中';
        }
        
        // 检查是否在f-string表达式内
        if (beforeCursor.match(/f['"][^'"]*{\s*$/) && !afterCursor.includes('}')) {
            return '在f-string表达式中';
        }
        
        // 检查是否在条件语句中
        if (beforeCursor.match(/if\s+$/)) {
            return '在if条件表达式中';
        }
        
        // 检查是否在for循环中
        if (beforeCursor.match(/for\s+$/)) {
            return '在for循环迭代表达式中';
        }
        
        // 默认，使用通用分析
        return '';
    }
}

/**
 * Java 代码分析器
 */
class JavaAnalyzer implements LanguageSpecificAnalyzer {
    /**
     * 分析代码结构
     * @param document 当前文档
     * @param position 当前位置
     */
    public analyzeCodeStructure(document: vscode.TextDocument, position: vscode.Position): CodeStructureInfo[] {
        const structures: CodeStructureInfo[] = [];
        const text = document.getText();
        console.log(position) 
        // 类和接口定义模式
        const classPatterns = [
            { regex: /public\s+class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?/g, type: 'class' },
            { regex: /private\s+class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?/g, type: 'private-class' },
            { regex: /protected\s+class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([^{]+))?/g, type: 'protected-class' },
            { regex: /public\s+interface\s+(\w+)(?:\s+extends\s+([^{]+))?/g, type: 'interface' },
            { regex: /public\s+enum\s+(\w+)/g, type: 'enum' }
        ];
        
        // 方法定义模式
        const methodPatterns = [
            { regex: /public\s+(?:static\s+)?(?:final\s+)?(?:<[^>]+>\s+)?(\w+)\s+(\w+)\s*\([^)]*\)(?:\s+throws\s+[^{]+)?\s*{/g, type: 'public-method' },
            { regex: /private\s+(?:static\s+)?(?:final\s+)?(?:<[^>]+>\s+)?(\w+)\s+(\w+)\s*\([^)]*\)(?:\s+throws\s+[^{]+)?\s*{/g, type: 'private-method' },
            { regex: /protected\s+(?:static\s+)?(?:final\s+)?(?:<[^>]+>\s+)?(\w+)\s+(\w+)\s*\([^)]*\)(?:\s+throws\s+[^{]+)?\s*{/g, type: 'protected-method' }
        ];
        
        // 导入模式
        const importPattern = /import\s+(static\s+)?([\w.]+)(?:\.\*)?;/g;
        
        // 提取类和接口
        for (const pattern of classPatterns) {
            let match;
            while ((match = pattern.regex.exec(text)) !== null) {
                structures.push({
                    type: pattern.type,
                    name: match[1] || '',
                    position: match.index
                });
            }
        }
        
        // 提取方法
        for (const pattern of methodPatterns) {
            let match;
            while ((match = pattern.regex.exec(text)) !== null) {
                structures.push({
                    type: pattern.type,
                    name: match[2] || '',
                    position: match.index
                });
            }
        }
        
        // 提取导入
        let match;
        while ((match = importPattern.exec(text)) !== null) {
            structures.push({
                type: match[1] ? 'static-import' : 'import',
                name: match[2] || '',
                position: match.index
            });
        }
        
        return structures.sort((a, b) => a.position - b.position);
    }
    
    /**
     * 分析当前作用域
     * @param document 当前文档
     * @param position 当前位置
     */
    public analyzeCurrentScope(document: vscode.TextDocument, position: vscode.Position): string {
        const text = document.getText();
        const offset = document.offsetAt(position);
        
        // 查找当前位置所在的方法或类
        let currentMethod = '';
        let currentClass = '';
        
        // 类定义模式
        const classPattern = /(?:public|private|protected)\s+class\s+(\w+)/g;
        
        // 方法定义模式
        const methodPattern = /(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?(?:<[^>]+>\s+)?(\w+)\s+(\w+)\s*\([^)]*\)/g;
        
        // 查找类
        let match;
        while ((match = classPattern.exec(text)) !== null) {
            const start = match.index;
            // 粗略估计类的结束位置
            let braceCount = 0;
            let classBodyStart = 0;
            
            // 找类体的开始位置
            for (let i = start; i < text.length; i++) {
                if (text[i] === '{') {
                    classBodyStart = i;
                    braceCount = 1;
                    break;
                }
            }
            
            // 没找到类体开始位置，跳过
            if (classBodyStart === 0) continue;
            
            // 找类体的结束位置
            let classBodyEnd = 0;
            
            for (let i = classBodyStart + 1; i < text.length; i++) {
                if (text[i] === '{') braceCount++;
                else if (text[i] === '}') braceCount--;
                
                if (braceCount === 0) {
                    classBodyEnd = i;
                    break;
                }
            }
            
            // 检查当前位置是否在这个类内
            if (offset > classBodyStart && offset < classBodyEnd) {
                currentClass = match[1] || '';
                
                // 如果找到类，查找所在方法
                // 重置方法模式匹配位置到类体开始
                methodPattern.lastIndex = classBodyStart;
                
                while ((match = methodPattern.exec(text)) !== null) {
                    // 跳过超出类体的方法
                    if (match.index > classBodyEnd) break;
                    
                    const methodStart = match.index;
                    // 找到方法体开始位置
                    let methodBodyStart = 0;
                    
                    for (let i = methodStart; i < text.length; i++) {
                        if (text[i] === '{') {
                            methodBodyStart = i;
                            braceCount = 1;
                            break;
                        }
                    }
                    
                    // 没找到方法体开始位置，跳过
                    if (methodBodyStart === 0) continue;
                    
                    // 找方法体结束位置
                    let methodBodyEnd = 0;
                    
                    for (let i = methodBodyStart + 1; i < text.length; i++) {
                        if (text[i] === '{') braceCount++;
                        else if (text[i] === '}') braceCount--;
                        
                        if (braceCount === 0) {
                            methodBodyEnd = i;
                            break;
                        }
                    }
                    
                    // 检查当前位置是否在这个方法内
                    if (offset > methodBodyStart && offset < methodBodyEnd) {
                        currentMethod = match[2] || '';
                        break;
                    }
                }
                
                break;  // 找到所在类后可以退出类查找循环
            }
        }
        
        // 返回作用域描述
        if (currentClass && currentMethod) {
            return `类 ${currentClass} 的方法 ${currentMethod} 内`;
        } else if (currentClass) {
            return `类 ${currentClass} 内`;
        } else if (currentMethod) {
            return `方法 ${currentMethod} 内`;
        } else {
            return '包级作用域';
        }
    }
    
    /**
     * 分析相关导入
     * @param document 当前文档
     * @param position 当前位置
     * @param symbols 相关符号
     */
    public analyzeRelatedImports(document: vscode.TextDocument, position: vscode.Position, symbols: string[]): string[] {
        const imports: string[] = [];
        const text = document.getText();
        console.log(position) 
        // 导入模式
        const importPattern = /import\s+(static\s+)?([\w.]+)(?:\.\*)?;/g;
        
        // 提取所有导入语句
        let match;
        while ((match = importPattern.exec(text)) !== null) {
            const isStaticImport = !!match[1];
            const importPath = match[2] || '';
            
            // 从导入路径中提取类名/包名
            const parts = importPath.split('.');
            const lastName = parts[parts.length - 1];
            
            // 检查是否导入了通配符
            const isWildcardImport = text.substring(match.index, match.index + match[0].length).includes('.*');
            
            // 检查是否有相关符号在这个导入中
            for (const symbol of symbols) {
                const plainSymbol = symbol.replace(/[*()]/g, ''); // 移除标记
                
                // 对于静态导入，检查是否使用了静态成员
                if (isStaticImport) {
                    if (isWildcardImport) {
                        // 静态导入通配符，难以确定具体成员
                        imports.push(`import static ${importPath}.*;`);
                        break;
                    } else if (parts.length > 1 && plainSymbol === parts[parts.length - 1]) {
                        imports.push(`import static ${importPath};`);
                        break;
                    }
                } 
                // 对于普通导入
                else {
                    if (lastName === plainSymbol || 
                        (isWildcardImport && parts.length > 1 && plainSymbol.startsWith(parts[parts.length - 2] + '.'))) {
                        imports.push(`import ${importPath}${isWildcardImport ? '.*' : ''};`);
                        break;
                    }
                }
            }
        }
        
        return imports;
    }
    
    /**
     * 分析语法上下文
     * @param document 当前文档
     * @param position 当前位置
     * @param beforeCursor 光标前的文本
     * @param afterCursor 光标后的文本
     */
    public analyzeSyntaxContext(
        document: vscode.TextDocument, 
        position: vscode.Position,
        beforeCursor: string, 
        afterCursor: string
    ): string {
        // 分析是否在特殊语法结构内
        console.log(position)
        console.log(document)
        // 检查是否在方法参数列表内
        if (beforeCursor.match(/\(\s*$/) || (beforeCursor.includes('(') && !afterCursor.includes(')'))) {
            const methodMatch = beforeCursor.match(/(\w+)\s*\([^)]*$/);
            if (methodMatch) {
                return `在方法 ${methodMatch[1]} 的参数列表中`;
            }
            return '在方法参数列表中';
        }
        
        // 检查是否在数组初始化内
        if (beforeCursor.match(/{\s*$/) || (beforeCursor.includes('{') && !afterCursor.includes('}'))) {
            if (beforeCursor.match(/new\s+\w+\s*\[[^\]]*\]\s*{\s*$/)) {
                return '在数组初始化中';
            }
            return '在代码块或初始化块中';
        }
        
        // 检查是否在字符串内
        if ((beforeCursor.match(/"[^"]*$/) && !afterCursor.includes('"'))) {
            return '在字符串中';
        }
        
        // 检查是否在条件语句中
        if (beforeCursor.match(/if\s*\(\s*$/)) {
            return '在if条件表达式中';
        }
        
        // 检查是否在for循环中
        if (beforeCursor.match(/for\s*\(\s*$/)) {
            return '在for循环表达式中';
        }
        
        // 检查是否在泛型定义内
        if (beforeCursor.match(/<[^>]*$/) && !afterCursor.includes('>')) {
            return '在泛型参数中';
        }
        
        // 检查是否在注解内
        if (beforeCursor.match(/@\w+\s*\(\s*$/) && !afterCursor.includes(')')) {
            const annotationMatch = beforeCursor.match(/@(\w+)/);
            if (annotationMatch) {
                return `在@${annotationMatch[1]}注解参数中`;
            }
            return '在注解参数中';
        }
        
        // 默认，使用通用分析
        return '';
    }
}

/**
 * 通用代码分析器（适用于没有专门分析器的语言）
 */
class GenericAnalyzer implements LanguageSpecificAnalyzer {
    /**
     * 分析代码结构
     * @param document 当前文档
     * @param position 当前位置
     */
    public analyzeCodeStructure(document: vscode.TextDocument, position: vscode.Position): CodeStructureInfo[] {
        const structures: CodeStructureInfo[] = [];
        const text = document.getText();
        console.log(position) 
        // 通用函数定义模式
        const functionPatterns = [
            { regex: /function\s+(\w+)\s*\([^)]*\)/g, type: 'function' },
            { regex: /(\w+)\s*=\s*function\s*\([^)]*\)/g, type: 'function' },
            { regex: /(\w+)\s*:\s*function\s*\([^)]*\)/g, type: 'method' }
        ];
        
        // 通用类定义模式
        const classPattern = /class\s+(\w+)/g;
        
        // 提取函数
        for (const pattern of functionPatterns) {
            let match;
            while ((match = pattern.regex.exec(text)) !== null) {
                structures.push({
                    type: pattern.type,
                    name: match[1] || '',
                    position: match.index
                });
            }
        }
        
        // 提取类
        let match;
        while ((match = classPattern.exec(text)) !== null) {
            structures.push({
                type: 'class',
                name: match[1] || '',
                position: match.index
            });
        }
        
        return structures.sort((a, b) => a.position - b.position);
    }
    
    /**
     * 分析当前作用域
     * @param document 当前文档
     * @param position 当前位置
     */
    public analyzeCurrentScope(document: vscode.TextDocument, position: vscode.Position): string {
        // 简单实现，只检测当前行前后的代码块开始/结束
        // 更复杂的作用域分析需要针对特定语言实现
        
        // 向上查找最近的函数/类/块定义
        const currentLine = position.line;
        let blockType = '';
        let blockName = '';
        
        // 向上查找20行以内
        for (let i = currentLine; i >= Math.max(0, currentLine - 20); i--) {
            const lineText = document.lineAt(i).text;
            
            // 查找函数定义
            const functionMatch = lineText.match(/(?:function\s+(\w+)|(\w+)\s*=\s*function|(\w+)\s*:\s*function)/);
            if (functionMatch) {
                blockType = '函数';
                blockName = functionMatch[1] || functionMatch[2] || functionMatch[3] || '';
                break;
            }
            
            // 查找类定义
            const classMatch = lineText.match(/class\s+(\w+)/);
            if (classMatch) {
                blockType = '类';
                blockName = classMatch[1] || '';
                break;
            }
            
            // 查找其他代码块开始
            if (lineText.includes('{') && !lineText.includes('}')) {
                const blockMatch = lineText.match(/(\w+)(?:\s*\([^)]*\))?\s*{/);
                if (blockMatch) {
                    blockType = '代码块';
                    blockName = blockMatch[1] || '';
                }
                break;
            }
        }
        
        if (blockType && blockName) {
            return `${blockType} ${blockName} 内`;
        } else if (blockType) {
            return `${blockType}内`;
        } else {
            return '全局作用域';
        }
    }
    
    /**
     * 分析相关导入
     * @param document 当前文档
     * @param position 当前位置
     * @param symbols 相关符号
     */
    public analyzeRelatedImports(document: vscode.TextDocument, position: vscode.Position, symbols: string[]): string[] {
        // 通用实现，尝试匹配常见的导入模式
        const imports: string[] = [];
        const text = document.getText();
        console.log(position) 
        console.log(symbols)
        // 通用导入模式
        const importPatterns = [
            /import\s+([^;]+);/g,                      // C++, Java 风格
            /import\s+([^;]+)(?:from\s+['"][^'"]+['"])?/g, // JavaScript/TypeScript 风格
            /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,   // Node.js require
            /#include\s*[<"]([^>"]+)[>"]/g,            // C/C++ include
            /using\s+([^;]+);/g                        // C++ using
        ];
        
        // 尝试每种模式
        for (const pattern of importPatterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                imports.push(match[0]);
            }
        }
        
        return imports;
    }
    
    /**
     * 分析语法上下文
     * @param document 当前文档
     * @param position 当前位置
     * @param beforeCursor 光标前的文本
     * @param afterCursor 光标后的文本
     */
    public analyzeSyntaxContext(
        document: vscode.TextDocument, 
        position: vscode.Position,
        beforeCursor: string, 
        afterCursor: string
    ): string {
        // 简单的通用语法分析
        console.log(document) 
        console.log(position)
        console.log(beforeCursor)
        console.log(afterCursor)
        // 检查括号平衡
        const openParens = (beforeCursor.match(/\(/g) || []).length;
        const closeParens = (beforeCursor.match(/\)/g) || []).length;
        
        const openBraces = (beforeCursor.match(/{/g) || []).length;
        const closeBraces = (beforeCursor.match(/}/g) || []).length;
        
        const openBrackets = (beforeCursor.match(/\[/g) || []).length;
        const closeBrackets = (beforeCursor.match(/\]/g) || []).length;
        
        // 检查引号
        const singleQuotes = (beforeCursor.match(/'/g) || []).length;
        const doubleQuotes = (beforeCursor.match(/"/g) || []).length;
        
        // 分析上下文
        if (openParens > closeParens) {
            return '在括号内';
        } else if (openBraces > closeBraces) {
            return '在花括号内';
        } else if (openBrackets > closeBrackets) {
            return '在方括号内';
        } else if (singleQuotes % 2 !== 0) {
            return '在单引号字符串内';
        } else if (doubleQuotes % 2 !== 0) {
            return '在双引号字符串内';
        }
        
        return '在代码区域';
    }
}

// 导出接口和类型以供其他模块使用
export { 
    LanguageSpecificAnalyzer, 
    CodeStructureInfo, 
    EnhancedAnalysisResult,
    TypeScriptAnalyzer,
    PythonAnalyzer,
    JavaAnalyzer,
    GenericAnalyzer
};