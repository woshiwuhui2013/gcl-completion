import * as vscode from 'vscode';
import { ContextAnalyzer, ContextInfo } from './contextAnalyzer';
import { LLMConnector } from './llmConnector';
import { CodeFormatter } from './codeFormatter';
import { PromptBuilder } from './promptBuilder';

/**
 * 代码补全提供者，协调各模块工作
 */
export class CompletionProvider {
    private contextAnalyzer: ContextAnalyzer;
    private llmConnector: LLMConnector;
    private codeFormatter: CodeFormatter;
    private promptBuilder: PromptBuilder;
    
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
        this.promptBuilder = new PromptBuilder();
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
            
            // 获取项目信息
            const projectInfo = await this.contextAnalyzer.analyzeProject();
            
            // 获取配置
            const config = vscode.workspace.getConfiguration('llm-code-assistant');
            const completionMode = config.get<string>('completionMode') || 'snippet';
            
            // 使用PromptBuilder构建提示
            const prompt = this.promptBuilder.buildPrompt(
                context,
                projectInfo,
                promptText,
                completionMode
            );
            
            // 调用LLM获取补全
            const rawCompletion = await this.llmConnector.getCompletion(prompt, cancellationToken);
            
            // 格式化生成的代码
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
}