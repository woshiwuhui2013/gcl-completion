import * as vscode from 'vscode';
import { ContextInfo } from './contextAnalyzer';
import { debug, log } from './utils';

/**
 * 提示词构建器 - 负责构建高质量的LLM提示词
 * 利用ContextAnalyzer收集的丰富上下文信息
 */
export class PromptBuilder {
    /**
     * 构建基础系统提示
     * @param completionMode 补全模式 ('line' 或 'snippet')
     * @param apiProvider API提供商
     * @param modelName 模型名称
     * @returns 基础系统提示
     */
    private buildSystemPrompt(
        completionMode: string,
        apiProvider: string,
        modelName: string
    ): string {
        // 基础系统提示，增加对上下文信息使用的指导
        let systemPrompt = `你是一个专业的代码助手，根据代码上下文提供高质量的代码补全。
${completionMode === 'line' ? '请只生成一行代码，不要包含换行符。' : '请生成合适的代码片段。'}
请确保生成的代码与现有代码风格一致，并且语法正确。
不要包含解释，只返回代码本身。

重要说明:
- 你只需生成光标位置处的代码，不要重复光标后方已存在的代码
- 光标位置用"|光标位置|"标记，你应该从这个位置开始生成代码
- 在单行模式下，只生成当前行缺失的部分，不要生成完整行
- 在代码段模式下，只生成光标处开始的代码块，不要复制已有的后续代码

我将提供以下上下文信息，请仔细利用这些信息生成最合适的代码补全：
1. 代码上下文：当前文件的代码片段，请优先参考这部分内容
2. 当前作用域：了解当前代码所在的函数或类范围
3. 语法上下文：了解光标是否在函数参数、条件语句等特定环境中
4. 相关标识符：当前上下文中使用的变量、函数等，优先使用这些已有标识符
5. 代码结构：了解周围代码的组织结构
6. 缩进信息：确保生成的代码保持正确的缩进级别
7. 相关导入：参考已经导入的模块，避免引入未导入的依赖
8. 项目信息：了解项目的依赖和环境`;

        // 根据不同的API提供商和模型定制提示
        if (apiProvider === 'openai' && modelName.includes('gpt-4')) {
            systemPrompt += '\n你拥有强大的代码理解能力，能够提供符合上下文的最佳代码。请注重代码质量和最佳实践。';
        } else if (apiProvider === 'anthropic' && modelName.includes('claude')) {
            systemPrompt += '\n你是Claude，擅长理解编程语言的上下文和意图，请提供优雅、高效的代码。';
        } else if (apiProvider === 'deepseek' && modelName.includes('deepseek-coder')) {
            systemPrompt += '\n你是Deepseek Coder，专门为代码补全设计的模型，拥有强大的编程能力和代码智能。';
        }

        return systemPrompt;
    }

    /**
     * 构建代码结构信息部分
     * @param contextInfo 上下文信息
     * @returns 代码结构描述
     */
    private buildCodeStructureInfo(contextInfo: ContextInfo): string {
        if (!contextInfo.codeStructure || contextInfo.codeStructure.length === 0) {
            return '';
        }

        // 获取最相关的几个代码结构
        const relevantStructures = contextInfo.codeStructure.slice(0, 5);
        const structureDescriptions = relevantStructures.map(structure => 
            `${structure.type}: ${structure.name}`
        );

        return `代码结构信息(用于理解当前代码的组织框架):\n${structureDescriptions.join('\n')}`;
    }

    /**
     * 构建语法上下文信息
     * @param contextInfo 上下文信息
     * @returns 语法上下文描述
     */
    private buildSyntaxContextInfo(contextInfo: ContextInfo): string {
        if (!contextInfo.syntaxContext) {
            return '';
        }

        return `当前语法上下文(用于生成符合当前语法环境的代码): ${contextInfo.syntaxContext}`;
    }

    /**
     * 构建作用域信息
     * @param contextInfo 上下文信息
     * @returns 作用域描述
     */
    private buildScopeInfo(contextInfo: ContextInfo): string {
        if (!contextInfo.currentScope) {
            return '';
        }

        return `当前作用域(用于确保代码在正确的范围内): ${contextInfo.currentScope}`;
    }

    /**
     * 构建相关导入信息
     * @param contextInfo 上下文信息
     * @returns 相关导入描述
     */
    private buildImportsInfo(contextInfo: ContextInfo): string {
        if (!contextInfo.relatedImports || contextInfo.relatedImports.length === 0) {
            return '';
        }

        return `相关导入(优先使用这些已导入的模块和库):\n${contextInfo.relatedImports.join('\n')}`;
    }

    /**
     * 构建符号信息
     * @param contextInfo 上下文信息
     * @returns 符号信息描述
     */
    private buildSymbolsInfo(contextInfo: ContextInfo): string {
        if (!contextInfo.symbolInfo || contextInfo.symbolInfo.length === 0) {
            return '';
        }

        // 按重要性排序符号
        // 高优先级符号（标记有*的）放在前面
        const prioritySymbols = contextInfo.symbolInfo.filter(s => s.includes('*'));
        const normalSymbols = contextInfo.symbolInfo.filter(s => !s.includes('*'));
        
        // 函数和类放在前面
        const functionSymbols = normalSymbols.filter(s => s.startsWith('function:') || s.includes('()'));
        const classSymbols = normalSymbols.filter(s => s.startsWith('class:'));
        const otherSymbols = normalSymbols.filter(s => 
            !s.startsWith('function:') && !s.startsWith('class:') && !s.includes('()')
        );

        // 组合所有符号，限制数量
        const allOrderedSymbols = [
            ...prioritySymbols,
            ...functionSymbols,
            ...classSymbols,
            ...otherSymbols
        ].slice(0, 20);

        return `相关标识符(优先使用这些已定义的变量、函数和类): ${allOrderedSymbols.join(', ')}`;
    }

    /**
     * 构建缩进信息
     * @param contextInfo 上下文信息
     * @returns 缩进信息描述
     */
    private buildIndentationInfo(contextInfo: ContextInfo): string {
        // 总是返回当前缩进信息，无论是否与预期缩进相同
        const indentStr = contextInfo.indentation.replace(/ /g, '␣').replace(/\t/g, '↹');
        
        if (contextInfo.indentation !== contextInfo.expectedIndentation) {
            const expectedStr = contextInfo.expectedIndentation.replace(/ /g, '␣').replace(/\t/g, '↹');
            return `缩进信息(确保生成代码符合正确格式): 当前缩进: "${indentStr}", 预期缩进: "${expectedStr}"`;
        }
        
        // 即使缩进相同，也返回当前缩进信息
        return `缩进信息(确保生成代码符合正确格式): 当前缩进: "${indentStr}"`;
    }

    /**
     * 构建完整的代码上下文
     * @param contextInfo 上下文信息
     * @param completionMode 补全模式
     * @returns 格式化的代码上下文
     */
    private buildCodeContextInfo(contextInfo: ContextInfo, completionMode: string): string {
        // 对于单行模式，提供更精简的上下文
        if (completionMode === 'line') {
            // 提取当前行和周围几行代码
            const lines = contextInfo.beforeCode.split('\n');
            const beforeLines = lines.slice(Math.max(0, lines.length - 5));
            const currentLine = contextInfo.beforeCursor + '|光标位置|' + contextInfo.afterCursor;
            const afterLines = contextInfo.afterCode.split('\n').slice(0, 5);
            
            return [
                `文件: ${contextInfo.fileName}`,
                `语言: ${contextInfo.languageId}`,
                '代码上下文(请密切关注这部分，它是你理解和补全代码的核心信息):',
                '--- 上文代码(直接在光标前) ---',
                ...beforeLines,
                '--- 当前行(| 表示光标位置) ---',
                currentLine,
                '--- 下文代码(直接在光标后，你不应该重复这部分代码) ---',
                ...afterLines,
                '注意: 请勿重复"光标位置"后面已存在的代码。你只需生成从光标位置开始的新代码。'
            ].join('\n');
        } else {
            // 对于代码段模式，提供更丰富的上下文
            return [
                `文件: ${contextInfo.fileName}`,
                `语言: ${contextInfo.languageId}`,
                '代码上下文(请密切关注这部分，它是你理解和补全代码的核心信息):',
                '--- 光标前代码 ---',
                contextInfo.beforeCode,
                '--- 当前行(| 表示光标位置) ---',
                contextInfo.beforeCursor + '|光标位置|' + contextInfo.afterCursor,
                '--- 光标后代码(这部分已存在，你不应该重复生成) ---',
                contextInfo.afterCode,
                '注意: 请勿重复"光标位置"后面已存在的代码。你只需生成从光标位置开始的新代码。'
            ].join('\n');
        }
    }

    /**
     * 构建项目信息
     * @param projectInfo 项目信息
     * @returns 项目信息描述
     */
    private buildProjectInfo(projectInfo: any): string {
        if (!projectInfo || !projectInfo.name) {
            return '';
        }

        let projectInfoText = `项目信息(用于了解代码所在环境): 项目名称: ${projectInfo.name}`;
        
        if (projectInfo.dependencies && projectInfo.dependencies.length > 0) {
            // 限制依赖列表大小，避免提示过长
            const topDependencies = projectInfo.dependencies.slice(0, 10);
            projectInfoText += `\n可用的主要依赖(优先使用这些库): ${topDependencies.join(', ')}`;
            
            if (projectInfo.dependencies.length > 10) {
                projectInfoText += ` 等${projectInfo.dependencies.length}个依赖`;
            }
        }

        return projectInfoText;
    }

    /**
     * 构建语言指导信息
     * @param languageId 语言ID
     * @returns 语言特定的指导
     */
    private buildLanguageGuidance(languageId: string): string {
        switch (languageId) {
            case 'typescript':
            case 'typescriptreact':
                return '语言特定指导: 请遵循TypeScript最佳实践，包括类型安全、接口使用和异步处理。';
            case 'javascript':
            case 'javascriptreact':
                return '语言特定指导: 请使用现代JavaScript特性(ES6+)，如箭头函数、解构赋值、Promise等。';
            case 'python':
                return '语言特定指导: 请遵循PEP 8编码规范，使用Pythonic的编程风格。';
            case 'java':
                return '语言特定指导: 请遵循Java编码规范，优先考虑可读性和代码结构。';
            case 'csharp':
                return '语言特定指导: 请遵循C#编码规范，利用语言特性如LINQ、异步/等待等。';
            // 可以添加更多语言
            default:
                return '';
        }
    }

    /**
     * 构建用户自定义提示
     * @param userPrompt 用户提示
     * @param defaultPrompt 默认提示
     * @returns 用户提示部分
     */
    private buildUserPrompt(userPrompt: string | null, defaultPrompt: string): string {
        if (userPrompt) {
            return `用户特别要求(请根据这个具体要求生成代码): ${userPrompt}`;
        }
        return `用户要求: ${defaultPrompt}`;
    }

    /**
     * 构建完整的LLM提示
     * 高效整合所有上下文信息
     * @param contextInfo 上下文信息
     * @param projectInfo 项目信息
     * @param userPrompt 用户提示
     * @param completionMode 补全模式
     * @returns 完整的提示字符串
     */
    public buildPrompt(
        contextInfo: ContextInfo,
        projectInfo: any,
        userPrompt: string | null,
        completionMode: string
    ): string {
        // 获取配置
        const config = vscode.workspace.getConfiguration('llm-code-assistant');
        const apiProvider = config.get<string>('apiProvider') || 'openai';
        const modelName = config.get<string>('modelName') || 'gpt-4';
        const defaultPrompt = config.get<string>('defaultPrompt') || '请根据上下文，在光标位置提供合适的代码补全。';
        const customPromptTemplate = config.get<string>('customPromptTemplate') || '';
        
        // 获取新的提示词配置选项
        const useCodeStructureInfo = config.get<boolean>('useCodeStructureInfo', true);
        const useSyntaxContextInfo = config.get<boolean>('useSyntaxContextInfo', true);
        const useRelatedImports = config.get<boolean>('useRelatedImports', true);
        const useProjectInfo = config.get<boolean>('useProjectInfo', true);
        const useLanguageSpecificGuidance = config.get<boolean>('useLanguageSpecificGuidance', true);
        
        // 如果用户提供了自定义模板，使用模板
        if (customPromptTemplate) {
            // 构建基本代码上下文
            const codeContext = this.buildCodeContextInfo(contextInfo, completionMode);
            
            // 构建增强的上下文信息，根据用户配置启用/禁用特定信息
            const enhancedContextParts = [];
            
            if (useCodeStructureInfo) {
                const codeStructureInfo = this.buildCodeStructureInfo(contextInfo);
                if (codeStructureInfo) enhancedContextParts.push(codeStructureInfo);
            }
            
            if (useSyntaxContextInfo) {
                const syntaxContextInfo = this.buildSyntaxContextInfo(contextInfo);
                if (syntaxContextInfo) enhancedContextParts.push(syntaxContextInfo);
                
                const scopeInfo = this.buildScopeInfo(contextInfo);
                if (scopeInfo) enhancedContextParts.push(scopeInfo);
            }
            
            if (useRelatedImports) {
                const importsInfo = this.buildImportsInfo(contextInfo);
                if (importsInfo) enhancedContextParts.push(importsInfo);
            }
            
            // 符号信息总是包含，因为它对代码补全非常重要
            const symbolsInfo = this.buildSymbolsInfo(contextInfo);
            if (symbolsInfo) enhancedContextParts.push(symbolsInfo);
            
            const indentationInfo = this.buildIndentationInfo(contextInfo);
            if (indentationInfo) enhancedContextParts.push(indentationInfo);
            
            // 合并增强的上下文信息
            const enhancedContext = enhancedContextParts.join('\n\n');
            
            // 构建项目信息（如果启用）
            let projectInfoText = '';
            if (useProjectInfo) {
                projectInfoText = this.buildProjectInfo(projectInfo);
            }
            
            // 合并所有信息，填充到模板中
            let prompt = customPromptTemplate
                .replace('{promptText}', userPrompt || defaultPrompt)
                .replace('{codeContext}', codeContext)
                .replace('{enhancedContext}', enhancedContext)
                .replace('{projectInfo}', projectInfoText);
            
            // 添加补全模式提示和警告不要重复已有代码
            prompt += `\n\n请提供${completionMode === 'line' ? '单行代码' : '完整代码段'}。`;
            prompt += '\n重要: 请仅生成光标位置处的代码，不要重复光标后已有的代码！';
            
            // 尝试限制提示词长度，以防止超出模型最大 token 限制
            const maxPromptTokens = config.get<number>('maxPromptTokens', 8192);
            prompt = this.truncatePrompt(prompt, maxPromptTokens);
            
            return prompt;
        }
        
        // 使用默认格式构建提示
        // 基础系统提示
        const systemPrompt = this.buildSystemPrompt(completionMode, apiProvider, modelName);
        
        // 代码上下文
        const codeContext = this.buildCodeContextInfo(contextInfo, completionMode);
        
        // 语言指导
        let languageGuidance = '';
        if (useLanguageSpecificGuidance) {
            languageGuidance = this.buildLanguageGuidance(contextInfo.languageId);
        }
        
        // 增强的上下文信息（根据用户配置包含/排除）
        const enhancedContextParts = [];
        
        // 作用域信息
        if (useSyntaxContextInfo) {
            const scopeInfo = this.buildScopeInfo(contextInfo);
            if (scopeInfo) enhancedContextParts.push(scopeInfo);
            
            const syntaxContextInfo = this.buildSyntaxContextInfo(contextInfo);
            if (syntaxContextInfo) enhancedContextParts.push(syntaxContextInfo);
        }
        
        // 代码结构信息
        if (useCodeStructureInfo) {
            const codeStructureInfo = this.buildCodeStructureInfo(contextInfo);
            if (codeStructureInfo) enhancedContextParts.push(codeStructureInfo);
        }
        
        // 符号信息总是包含
        const symbolsInfo = this.buildSymbolsInfo(contextInfo);
        if (symbolsInfo) enhancedContextParts.push(symbolsInfo);
        
        // 相关导入信息
        if (useRelatedImports) {
            const importsInfo = this.buildImportsInfo(contextInfo);
            if (importsInfo) enhancedContextParts.push(importsInfo);
        }
        
        // 缩进信息总是包含
        const indentationInfo = this.buildIndentationInfo(contextInfo);
        if (indentationInfo) enhancedContextParts.push(indentationInfo);
        
        // 项目信息
        let projectInfoText = '';
        if (useProjectInfo) {
            projectInfoText = this.buildProjectInfo(projectInfo);
        }
        
        // 用户提示
        const userPromptText = this.buildUserPrompt(userPrompt, defaultPrompt);
        
        // 记录构建过程
        debug(`构建提示，语言: ${contextInfo.languageId}, 模式: ${completionMode}`);
        debug(`增强上下文部分: ${enhancedContextParts.length}个`);
        
        // 组合所有部分
        const finalPromptParts = [
            systemPrompt,
            '',
            codeContext,
            '',
            ...enhancedContextParts
        ];
        
        if (projectInfoText) {
            finalPromptParts.push('', projectInfoText);
        }
        
        if (languageGuidance) {
            finalPromptParts.push('', languageGuidance);
        }
        
        finalPromptParts.push('', userPromptText, '', 
            `请提供${completionMode === 'line' ? '单行代码' : '完整代码段'}。`,
            '重要: 请仅生成光标位置处的代码，不要重复光标后已有的代码！'
        );
        
        let finalPrompt = finalPromptParts.filter(Boolean).join('\n');
        
        // 限制提示词长度
        const maxPromptTokens = config.get<number>('maxPromptTokens', 4000);
        finalPrompt = this.truncatePrompt(finalPrompt, maxPromptTokens);
        
        // 记录最终提示词长度
        debug(`最终提示词长度: ${finalPrompt.length}个字符 prompt: ${finalPrompt}`);
        return finalPrompt;
    }
    
    /**
     * 尝试截断提示词以避免超出token限制
     * 这是一个简单的估算方法，更精确的方法需要使用模型特定的tokenizer
     * @param prompt 原始提示词
     * @param maxTokens 最大token数
     * @returns 截断后的提示词
     */
    private truncatePrompt(prompt: string, maxTokens: number): string {
        // 粗略估计：平均每个token约为4个字符
        // 这只是一个简单估算，实际上不同语言和字符的token计算会有很大差异
        const estimatedTokens = prompt.length / 4;
        
        if (estimatedTokens <= maxTokens) {
            return prompt;  // 不需要截断
        }
        
        // 截断提示词，保留开头和结尾部分
        // 优先保留系统提示和代码上下文
        const lines = prompt.split('\n');
        
        // 保留系统提示（前10行）和最后10行（包含用户请求和指令）
        const systemLines = lines.slice(0, 10);
        const endLines = lines.slice(-10);
        
        // 计算中间部分可以保留的行数
        const remainingTokensForMiddle = maxTokens - (systemLines.join('\n').length + endLines.join('\n').length) / 4;
        const remainingCharsForMiddle = remainingTokensForMiddle * 4;
        
        if (remainingCharsForMiddle <= 0) {
            // 如果系统提示和结尾已经超过限制，则各减少一半
            debug(`提示词过长，进行粗略截断`);
            return systemLines.slice(0, 5).join('\n') + '\n...\n' + endLines.slice(-5).join('\n');
        }
        
        // 从中间部分选择最重要的内容
        const middleLines = lines.slice(10, -10);
        
        // 优先保留包含某些关键词的行
        const priorityKeywords = ['当前作用域', '语法上下文', '相关标识符', '缩进', '项目名称'];
        const priorityLines: string[] = [];
        const otherLines: string[] = [];
        
        for (const line of middleLines) {
            if (priorityKeywords.some(keyword => line.includes(keyword))) {
                priorityLines.push(line);
            } else {
                otherLines.push(line);
            }
        }
        
        // 尝试保留所有优先行
        let currentChars = priorityLines.join('\n').length;
        
        if (currentChars <= remainingCharsForMiddle) {
            // 还有空间，添加一些其他行
            const remainingChars = remainingCharsForMiddle - currentChars;
            let additionalLines: string[] = [];
            let additionalChars = 0;
            
            for (const line of otherLines) {
                if (additionalChars + line.length + 1 <= remainingChars) {  // +1 for newline
                    additionalLines.push(line);
                    additionalChars += line.length + 1;
                } else {
                    break;
                }
            }
            
            // 组合最终的提示词
            const truncatedMiddle = [...priorityLines, ...additionalLines].join('\n');
            return [...systemLines, truncatedMiddle, ...endLines].join('\n');
        } else {
            // 优先行太多，需要进一步截断
            let selectedPriorityLines: string[] = [];
            let selectedChars = 0;
            
            for (const line of priorityLines) {
                if (selectedChars + line.length + 1 <= remainingCharsForMiddle) {
                    selectedPriorityLines.push(line);
                    selectedChars += line.length + 1;
                } else {
                    break;
                }
            }
            
            // 组合最终的提示词
            const truncatedMiddle = selectedPriorityLines.join('\n');
            return [...systemLines, truncatedMiddle, ...endLines].join('\n');
        }
    }
}