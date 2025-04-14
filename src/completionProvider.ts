import * as vscode from 'vscode';
import { ContextAnalyzer,ContextInfo } from './contextAnalyzer';
import { LLMConnector } from './llmConnector';
import { CodeFormatter } from './codeFormatter';

/**
 * 代码补全提供者，协调各模块工作
 */
export class CompletionProvider {
    private contextAnalyzer: ContextAnalyzer;
    private llmConnector: LLMConnector;
    private codeFormatter: CodeFormatter;
    
    /**
     * 构造函数
     * @param contextAnalyzer 上下文分析器
     * @param llmConnector LLM连接器
     * @param codeFormatter 代码格式化器
     */
    constructor(
        contextAnalyzer: ContextAnalyzer,
        llmConnector: LLMConnector,
        codeFormatter: CodeFormatter
    ) {
        this.contextAnalyzer = contextAnalyzer;
        this.llmConnector = llmConnector;
        this.codeFormatter = codeFormatter;
    }
    
    /**
     * 提供代码补全
     * @param editor 活动编辑器
     * @param promptText 用户提示文本
     * @param cancellationToken 取消令牌
     * @returns 生成的代码建议
     */
    public async provideCompletion(
        editor: vscode.TextEditor,
        promptText: string,
        cancellationToken?: vscode.CancellationToken
    ): Promise<string> {
        try {
            // 获取代码上下文
            const context = this.contextAnalyzer.getContext(editor);
            

            
            // 获取项目信息（可选）
            const projectInfo = await this.contextAnalyzer.analyzeProject();
            
            
            // 构建提示
            const prompt = await this.buildPrompt(promptText, context, projectInfo);
            
            // 调用LLM获取补全
            const rawCompletion = await this.llmConnector.getCompletion(prompt, cancellationToken);
            
            // 格式化生成的代码
            const config = vscode.workspace.getConfiguration('llm-code-assistant');
            const completionMode = config.get<string>('completionMode') || 'snippet';
            
            let formattedCode;
            if (completionMode === 'line') {
                // 单行模式
                const lines = rawCompletion.split('\n').map(line => line.trim()).filter(line => line.length > 0);
                const singleLine = lines.length > 0 ? lines[0] : '';
                formattedCode = this.codeFormatter.formatSingleLine(singleLine, context.indentation);
            } else {
                // 代码段模式
                formattedCode = this.codeFormatter.formatCodeSnippet(rawCompletion, context.indentation);
            }
            
            // 应用代码风格
            formattedCode = this.codeFormatter.applyCodeStyle(formattedCode, editor.document);
            
            return formattedCode;
        } catch (error: any) {
            throw new Error(`代码补全错误: ${error.message}`);
        }
    }
    
    /**
     * 构建提示
     * @param promptText 用户提示文本
     * @param context 代码上下文
     * @param projectInfo 项目信息
     * @returns 构建好的提示
     */
    private async buildPrompt(
        promptText: string,
        context: ContextInfo,
        projectInfo: any
    ): Promise<string> {
        // 获取配置的提示模板
        const config = vscode.workspace.getConfiguration('llm-code-assistant');
        const completionMode = config.get<string>('completionMode') || 'snippet';
        let promptTemplate = config.get<string>('customPromptTemplate') || '';
        
        if (!promptTemplate) {
            // 默认提示模板
            promptTemplate = '请根据以下代码上下文，{promptText}。请确保代码风格一致并能正常工作：\n\n{codeContext}';
        }
        
        // 构建代码上下文
        const codeContext = this.buildCodeContext(context, completionMode);
        
        // 填充模板
        let prompt = promptTemplate
            .replace('{promptText}', promptText)
            .replace('{codeContext}', codeContext);
        
        // 添加项目信息（如果有）
        if (projectInfo.name) {
            prompt += `\n\n项目名称: ${projectInfo.name}`;
            
            if (projectInfo.dependencies.length > 0) {
                // 限制依赖列表大小，避免提示过长
                const topDependencies = projectInfo.dependencies.slice(0, 10);
                prompt += `\n主要依赖: ${topDependencies.join(', ')}`;
                
                if (projectInfo.dependencies.length > 10) {
                    prompt += ` 等${projectInfo.dependencies.length}个依赖`;
                }
            }
        }
        
        // 添加补全模式提示
        prompt += `\n\n请提供${completionMode === 'line' ? '单行代码' : '完整代码段'}。`;
        
        return prompt;
    }
    
    /**
     * 构建代码上下文
     * @param context 代码上下文信息
     * @param completionMode 补全模式
     * @returns 格式化的代码上下文字符串
     */
    private buildCodeContext(context: ContextInfo, completionMode: string): string {
        // 对于单行模式，我们只需要当前行和周围几行
        if (completionMode === 'line') {
            // 提取当前行和周围5行代码
            const lines = context.beforeCode.split('\n');
            const beforeLines = lines.slice(Math.max(0, lines.length - 5));
            const currentLine = context.beforeCursor + '|光标位置|' + context.afterCursor;
            const afterLines = context.afterCode.split('\n').slice(0, 5);
            
            return [
                `文件: ${context.fileName}`,
                `语言: ${context.languageId}`,
                '代码上下文 (| 表示光标位置):',
                ...beforeLines,
                currentLine,
                ...afterLines
            ].join('\n');
        } else {
            // 对于代码段模式，我们提供更多的上下文
            return [
                `文件: ${context.fileName}`,
                `语言: ${context.languageId}`,
                '代码上下文:',
                '--- 光标前代码 ---',
                context.beforeCode,
                '--- 当前行 ---',
                context.beforeCursor + '|光标位置|' + context.afterCursor,
                '--- 光标后代码 ---',
                context.afterCode
            ].join('\n');
        }
    }
}