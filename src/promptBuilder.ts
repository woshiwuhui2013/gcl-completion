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
        // 基础系统提示，明确说明每个上下文信息的用途和应用方式
        let systemPrompt = `你是一个专业的代码助手，根据代码上下文提供高质量的代码补全。
${completionMode === 'line' ? '请只生成一行代码，不要包含换行符。' : '请生成合适的代码片段。'}
请确保生成的代码与现有代码风格一致，并且语法正确。
不要包含解释，只返回代码本身。

重要说明:
- 你只需生成光标位置处的代码，不要重复光标后方已存在的代码
- 光标位置用"|光标位置|"标记，你应该从这个位置开始生成代码
- 在单行模式下，只生成当前行缺失的部分，不要生成完整行
- 在代码段模式下，只生成光标处开始的代码块，不要复制已有的后续代码

我将为你提供多种类型的信息，每种信息都有明确的用途：

1. 代码上下文：这是最基础的信息，包含光标前后的代码。请基于这些代码来理解整体逻辑和结构。

2. 当前作用域：告诉你当前代码所处的函数或类。使用这个信息来确保生成的代码在正确的上下文环境中，引用合适的变量和方法。

3. 语法上下文：告诉你光标当前是否在特殊语法结构中（如函数参数、对象字面量等）。这会影响你生成的代码格式和类型。

4. 相关标识符：当前上下文中出现的变量、函数和类名。优先使用这些已定义的标识符来保持代码一致性，避免引入新的未定义标识符。

5. 代码结构信息：周围代码的组织结构，如函数、类和控制流语句。根据这些结构来确保生成的代码符合项目的架构风格。

6. 缩进信息：当前行的缩进级别。确保生成的代码保持正确的缩进，特别是在生成代码块时。

7. 相关导入：已导入的模块和库。优先使用这些已导入的模块，避免引入未导入的依赖。

8. 项目信息：项目的整体情况，包括依赖和文件结构。这有助于生成更符合项目风格的代码。`;

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
     * 构建代码结构信息部分，明确指导模型如何应用这些信息
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

        return `代码结构信息:\n${structureDescriptions.join('\n')}\n应用指导：利用这些代码结构信息来确保你生成的代码符合项目的架构模式。例如，如果你看到类和方法的组织方式，请遵循相同的模式。`;
    }

    /**
     * 构建语法上下文信息，明确指导模型如何应用这些信息
     * @param contextInfo 上下文信息
     * @returns 语法上下文描述
     */
    private buildSyntaxContextInfo(contextInfo: ContextInfo): string {
        if (!contextInfo.syntaxContext) {
            return '';
        }

        return `当前语法上下文: ${contextInfo.syntaxContext}\n应用指导：这告诉你光标位置所处的语法环境。例如，如果你在函数参数列表中，应该生成参数相关的代码；如果在对象字面量中，应该生成属性定义等。`;
    }

    /**
     * 构建作用域信息，明确指导模型如何应用这些信息
     * @param contextInfo 上下文信息
     * @returns 作用域描述
     */
    private buildScopeInfo(contextInfo: ContextInfo): string {
        if (!contextInfo.currentScope) {
            return '';
        }

        return `当前作用域: ${contextInfo.currentScope}\n应用指导：这表明当前代码位于哪个函数或类中。利用这个信息来确保你访问正确的变量和方法，保持作用域的一致性，避免引用不可访问的变量。`;
    }

    /**
     * 构建相关导入信息，明确指导模型如何应用这些信息
     * @param contextInfo 上下文信息
     * @returns 相关导入描述
     */
    private buildImportsInfo(contextInfo: ContextInfo): string {
        if (!contextInfo.relatedImports || contextInfo.relatedImports.length === 0) {
            return '';
        }

        return `相关导入:\n${contextInfo.relatedImports.join('\n')}\n应用指导：优先使用这些已导入的模块和类，避免引入未导入的依赖。如果你需要使用未导入的功能，最好使用这些已导入模块的类似功能。`;
    }

    /**
     * 构建符号信息，明确指导模型如何应用这些信息
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

        return `相关标识符: ${allOrderedSymbols.join(', ')}\n应用指导：这些是当前上下文中使用的变量、函数和类。优先使用这些已定义的标识符，标记有*的是最重要的。通过重用这些标识符来保持代码的连贯性和一致性，避免重新定义或创建新的标识符。`;
    }

    /**
     * 构建缩进信息，明确指导模型如何应用这些信息
     * @param contextInfo 上下文信息
     * @returns 缩进信息描述
     */
    private buildIndentationInfo(contextInfo: ContextInfo): string {
        // 总是返回当前缩进信息，无论是否与预期缩进相同
        const indentStr = contextInfo.indentation.replace(/ /g, '␣').replace(/\t/g, '↹');
        
        if (contextInfo.indentation !== contextInfo.expectedIndentation) {
            const expectedStr = contextInfo.expectedIndentation.replace(/ /g, '␣').replace(/\t/g, '↹');
            return `缩进信息: 当前缩进: "${indentStr}", 预期缩进: "${expectedStr}"\n应用指导：当前缩进是光标所在行的缩进，预期缩进是根据上下文推断的下一行应该使用的缩进。生成代码时请使用预期缩进，尤其是在生成新的代码块或嵌套结构时。`;
        }
        
        // 即使缩进相同，也返回当前缩进信息
        return `缩进信息: 当前缩进: "${indentStr}"\n应用指导：保持这个缩进级别以确保代码格式正确。缩进有助于表示代码的层级结构，确保你生成的代码保持一致的缩进风格。`;
    }

    /**
     * 构建完整的代码上下文，明确指导模型如何使用这些信息
     * @param contextInfo 上下文信息
     * @param completionMode 补全模式
     * @returns 格式化的代码上下文
     */
    private buildCodeContextInfo(contextInfo: ContextInfo, completionMode: string): string {
        // 对于单行模式，提供更精简的上下文
        if (completionMode === 'line') {
            // 提取当前行和周围几行代码
            const beforeLines = contextInfo.beforeCode.split('\n');
            const currentLine = contextInfo.beforeCursor + '|光标位置|' + contextInfo.afterCursor;
            const afterLines = contextInfo.afterCode.split('\n');
            
            return [
                `文件: ${contextInfo.fileName}`,
                `语言: ${contextInfo.languageId}`,
                '代码上下文(核心信息):',
                '--- 当前函数/类的前置代码 ---',
                ...beforeLines,
                '--- 当前行(| 表示光标位置) ---',
                currentLine,
                '--- 当前函数/类的后续代码(已存在，不要重复生成) ---',
                ...afterLines,
                '应用指导：这些代码提供了完整的上下文环境。分析前置代码以理解当前的逻辑流程和变量状态；查看当前行以确定需要补全的位置；参考后续代码以确保你生成的内容能够与之无缝衔接。请勿重复"光标位置"后面已存在的代码。'
            ].join('\n');
        } else {
            // 对于代码段模式，提供函数/类的完整上下文
            return [
                `文件: ${contextInfo.fileName}`,
                `语言: ${contextInfo.languageId}`,
                '代码上下文(核心信息):',
                '--- 当前函数/类的前置代码 ---',
                contextInfo.beforeCode,
                '--- 当前行(| 表示光标位置) ---',
                contextInfo.beforeCursor + '|光标位置|' + contextInfo.afterCursor,
                '--- 当前函数/类的后续代码(已存在，不要重复生成) ---',
                contextInfo.afterCode,
                '应用指导：这些代码提供了完整的上下文环境。分析前置代码以理解当前的逻辑流程和函数/类的结构；查看当前行以确定需要补全的位置；参考后续代码以确保你生成的内容能够与之无缝衔接。请勿重复"光标位置"后面已存在的代码。'
            ].join('\n');
        }
    }

    /**
     * 构建项目信息，明确指导模型如何应用这些信息
     * @param projectInfo 项目信息
     * @returns 项目信息描述
     */
    private buildProjectInfo(projectInfo: any): string {
        if (!projectInfo || !projectInfo.name) {
            return '';
        }

        let projectInfoText = `项目信息: 项目名称: ${projectInfo.name}`;
        
        if (projectInfo.dependencies && projectInfo.dependencies.length > 0) {
            // 限制依赖列表大小，避免提示过长
            const topDependencies = projectInfo.dependencies.slice(0, 10);
            projectInfoText += `\n可用的主要依赖: ${topDependencies.join(', ')}`;
            
            if (projectInfo.dependencies.length > 10) {
                projectInfoText += ` 等${projectInfo.dependencies.length}个依赖`;
            }
        }

        projectInfoText += `\n应用指导：了解项目名称有助于理解代码的整体目标。优先使用列出的依赖库，因为这些库已经在项目中引入。如果需要特定功能，首先考虑是否可以使用这些已有依赖实现。`;

        return projectInfoText;
    }

    /**
     * 构建语言特定的指导，明确说明如何应用到代码生成中
     * @param languageId 语言ID
     * @returns 语言特定的指导
     */
    private buildLanguageGuidance(languageId: string): string {
        let guidance = '';
        switch (languageId) {
            case 'typescript':
            case 'typescriptreact':
                guidance = '语言特定指导: 请遵循TypeScript最佳实践，包括:\n' +
                           '- 使用明确的类型注解而非any\n' +
                           '- 利用接口和类型别名定义复杂类型\n' +
                           '- 正确处理null和undefined检查\n' +
                           '- 使用async/await处理异步操作\n' +
                           '- 利用可选链和空值合并';
                break;
            case 'javascript':
            case 'javascriptreact':
                guidance = '语言特定指导: 请使用现代JavaScript特性(ES6+)，包括:\n' +
                           '- 箭头函数保持this上下文\n' +
                           '- 解构赋值简化对象和数组操作\n' +
                           '- 模板字符串构建复杂字符串\n' +
                           '- Promise和async/await处理异步\n' +
                           '- 扩展运算符复制对象和数组';
                break;
            case 'python':
                guidance = '语言特定指导: 请遵循PEP 8编码规范，包括:\n' +
                           '- 使用4空格缩进\n' +
                           '- 函数和类之间空两行\n' +
                           '- 使用列表推导式和生成器表达式\n' +
                           '- 使用f-string进行字符串格式化\n' +
                           '- 利用装饰器和上下文管理器';
                break;
            case 'java':
                guidance = '语言特定指导: 请遵循Java编码规范，包括:\n' +
                           '- 使用驼峰命名法\n' +
                           '- 正确处理异常和资源关闭\n' +
                           '- 利用泛型确保类型安全\n' +
                           '- 使用Stream API处理集合操作\n' +
                           '- 优先使用接口而非实现类作为变量类型';
                break;
            case 'csharp':
                guidance = '语言特定指导: 请遵循C#编码规范，包括:\n' +
                           '- 使用PascalCase命名类和方法\n' +
                           '- 使用LINQ简化集合操作\n' +
                           '- 使用异步/等待模式\n' +
                           '- 利用属性而非公共字段\n' +
                           '- 使用nameof操作符而非硬编码字符串';
                break;
            default:
                return '';
        }
        
        return guidance + '\n应用指导：在生成代码时应用这些语言特定的最佳实践和惯例，确保代码不仅能正常工作，还符合该语言的标准编码风格。';
        
        return guidance + '\n应用指导：在生成代码时应用这些语言特定的最佳实践和惯例，确保代码不仅能正常工作，还符合该语言的标准编码风格。';
    }

    /**
     * 构建用户自定义提示，明确指导如何应用用户的特定需求
     * @param userPrompt 用户提示
     * @param defaultPrompt 默认提示
     * @returns 用户提示部分
     */
    private buildUserPrompt(userPrompt: string | null, defaultPrompt: string): string {
        if (userPrompt) {
            return `用户特别要求: ${userPrompt}\n应用指导：这是用户的具体需求，应当优先满足这个要求，同时结合上下文中的所有信息来生成最合适的代码。`;
        }
        return `用户要求: ${defaultPrompt}\n应用指导：这是一个通用的代码补全请求，应当根据上下文分析和最佳实践生成代码。`;
    }

    /**
     * 构建完整的LLM提示
     * 高效整合所有上下文信息，并明确说明如何应用
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
            '## 代码上下文（核心参考信息）',
            codeContext,
            '',
            '## 增强上下文信息（辅助参考信息）',
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
        console.log(`最终提示词长度: ${finalPrompt.length}个字符, 内容为： ${finalPrompt}`);
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
        const sections = prompt.split('## ');
        
        // 确保至少有两个部分（系统提示和某些其他内容）
        if (sections.length < 2) {
            // 简单地截断提示词
            const targetLength = maxTokens * 4;
            const halfLength = targetLength / 2;
            return prompt.substring(0, halfLength) + "\n...\n" + prompt.substring(prompt.length - halfLength);
        }
        
        // 识别和保留关键部分
        let systemPrompt = sections[0];
        let codeContext = '';
        let enhancedContext = '';
        let userPrompt = '';
        let finalInstructions = '';
        
        for (let i = 1; i < sections.length; i++) {
            const section = sections[i];
            if (section.startsWith('代码上下文')) {
                codeContext = '## ' + section;
            } else if (section.startsWith('增强上下文信息')) {
                enhancedContext = '## ' + section;
            } else if (section.includes('用户要求') || section.includes('用户特别要求')) {
                // 提取用户提示和最终指令
                const parts = section.split('\n\n');
                for (const part of parts) {
                    if (part.includes('用户要求') || part.includes('用户特别要求')) {
                        userPrompt = part;
                    } else if (part.includes('请提供') || part.includes('重要:')) {
                        if (finalInstructions) {
                            finalInstructions += '\n\n' + part;
                        } else {
                            finalInstructions = part;
                        }
                    }
                }
            }
        }
        
        // 这些部分按重要性排序
        const criticalParts = [
            systemPrompt,            // 系统提示（最重要）
            codeContext,             // 代码上下文（非常重要）
            userPrompt,              // 用户提示（重要）
            finalInstructions        // 最终指令（重要）
        ].filter(Boolean);
        
        // 计算关键部分的token数
        const criticalText = criticalParts.join('\n\n');
        const criticalTokens = criticalText.length / 4;
        
        // 如果关键部分已经超过限制，必须进一步截断
        if (criticalTokens > maxTokens) {
            // 仅保留系统提示的前半部分和代码上下文的前半部分
            const systemTokens = systemPrompt.length / 4;
            const codeContextTokens = codeContext ? codeContext.length / 4 : 0;
            
            if (systemTokens + codeContextTokens > maxTokens) {
                // 如果系统提示和代码上下文加起来都超过了限制
                const availableTokens = maxTokens * 0.9; // 留一些余量
                const systemRatio = systemTokens / (systemTokens + codeContextTokens);
                const systemChars = Math.floor(availableTokens * 4 * systemRatio);
                const codeChars = Math.floor(availableTokens * 4 * (1 - systemRatio));
                
                let truncatedPrompt = systemPrompt.substring(0, systemChars);
                if (codeContext) {
                    truncatedPrompt += '\n\n(代码上下文已截断)\n' + 
                                      codeContext.substring(0, codeChars);
                }
                
                return truncatedPrompt + '\n\n请根据可见的上下文提供最合理的代码补全。';
            } else {
                // 省略增强上下文信息，保留系统提示、代码上下文和用户提示
                return [systemPrompt, codeContext, userPrompt, finalInstructions]
                    .filter(Boolean)
                    .join('\n\n');
            }
        }
        
        // 计算可以用于增强上下文的token数
        const remainingTokens = maxTokens - criticalTokens;
        
        // 如果还有剩余token，添加一部分增强上下文
        if (remainingTokens > 0 && enhancedContext) {
            // 解析增强上下文中的各部分
            const enhancedParts = enhancedContext.split('\n\n').filter(Boolean);
            
            // 按重要性排序的增强上下文部分
            const prioritizedParts = [];
            
            // 首先添加标题
            if (enhancedParts.length > 0 && enhancedParts[0].startsWith('## 增强上下文信息')) {
                prioritizedParts.push(enhancedParts[0]);
                enhancedParts.shift();
            }
            
            // 添加符号信息和缩进信息（最重要的）
            for (const part of [...enhancedParts]) {
                if (part.includes('相关标识符') || part.includes('缩进信息')) {
                    prioritizedParts.push(part);
                    enhancedParts.splice(enhancedParts.indexOf(part), 1);
                }
            }
            
            // 添加作用域和语法上下文信息（次重要）
            for (const part of [...enhancedParts]) {
                if (part.includes('当前作用域') || part.includes('语法上下文')) {
                    prioritizedParts.push(part);
                    enhancedParts.splice(enhancedParts.indexOf(part), 1);
                }
            }
            
            // 添加剩余部分
            prioritizedParts.push(...enhancedParts);
            
            // 逐个添加部分，直到接近token限制
            let selectedParts = [];
            let currentTokens = criticalTokens;
            
            for (const part of prioritizedParts) {
                const partTokens = part.length / 4;
                if (currentTokens + partTokens <= maxTokens * 0.98) { // 留一点余量
                    selectedParts.push(part);
                    currentTokens += partTokens;
                } else {
                    break;
                }
            }
            
            // 如果无法添加任何增强部分，至少添加一条说明
            if (selectedParts.length === 0 || (selectedParts.length === 1 && selectedParts[0].startsWith('## '))) {
                return criticalText + '\n\n(增强上下文信息已省略以符合token限制)';
            }
            
            // 组合所选部分
            const selectedEnhancedContext = selectedParts.join('\n\n');
            
            // 组合最终提示词
            return criticalParts.slice(0, 2).join('\n\n') + '\n\n' + selectedEnhancedContext + 
                   '\n\n' + criticalParts.slice(2).join('\n\n');
        }
        
        // 如果没有剩余token或没有增强上下文，直接返回关键部分
        return criticalText;
    }
}