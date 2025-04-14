import * as vscode from 'vscode';
import { ContextAnalyzer, ContextInfo } from './contextAnalyzer';
import { LLMConnector } from './llmConnector';
import { CodeFormatter } from './codeFormatter';
import { log, showError, delay } from './utils';

/**
 * 内联代码补全提供者
 * 使用VSCode的内联补全API提供代码建议
 */
export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    private contextAnalyzer: ContextAnalyzer;
    private llmConnector: LLMConnector;
    private codeFormatter: CodeFormatter;
    private userPrompt: string | null = null;
    private pendingRequest: boolean = false;
    private pendingRequestTimeout: NodeJS.Timeout | null = null;
    private lastRequestTime: number = 0;
    private readonly REQUEST_DEBOUNCE_TIME = 500; // 请求防抖时间(毫秒)
    private readonly REQUEST_TIMEOUT = 60000; // 请求超时时间(毫秒)
    
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
     * 设置用户提示
     * @param prompt 用户提示
     */
    public setUserPrompt(prompt: string | null): void {
        this.userPrompt = prompt;
        
        // 用户提示只使用一次，之后重置
        setTimeout(() => {
            this.userPrompt = null;
        }, 5000);
    }
    
    /**
     * 提供内联代码补全
     * @param document 当前文档
     * @param position 光标位置
     * @param context 补全上下文
     * @param token 取消令牌
     * @returns 内联补全项目列表
     */
    public async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null> {
        // 防抖处理，避免快速输入时频繁请求
        const now = Date.now();
        if (now - this.lastRequestTime < this.REQUEST_DEBOUNCE_TIME) {
            return null;
        }
        this.lastRequestTime = now;
        
        // 检查是否已有挂起的请求，如果有则取消
        if (this.pendingRequest) {
            if (this.pendingRequestTimeout) {
                clearTimeout(this.pendingRequestTimeout);
                this.pendingRequestTimeout = null;
            }
            // 我们不立即重置pendingRequest标志，而是在一小段延迟后再尝试
            await delay(100);
            
            // 如果还是有挂起的请求，可能是之前的请求未完成，这里直接返回
            if (this.pendingRequest) {
                log('已有请求正在处理中，跳过当前请求');
                return null;
            }
        }
        
        // 检查是否是手动触发或自动触发
        const config = vscode.workspace.getConfiguration('llm-code-assistant');
        const autoSuggest = config.get<boolean>('autoSuggest', false);
        const isTriggeredByCommand = context && context.triggerKind !== undefined;
        
        // 如果没有自动建议且没有用户提示且不是手动触发，则不提供建议
        if (!autoSuggest && !this.userPrompt && !isTriggeredByCommand) {
            return null;
        }
        
        // 设置请求超时
        this.pendingRequestTimeout = setTimeout(() => {
            log('请求超时，自动取消');
            this.pendingRequest = false;
            this.pendingRequestTimeout = null;
        }, this.REQUEST_TIMEOUT);
        
        try {
            this.pendingRequest = true;
            
            // 创建编辑器对象用于上下文分析
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                this.resetPendingState();
                return null;
            }
            
            // 检查取消令牌
            if (token.isCancellationRequested) {
                this.resetPendingState();
                return null;
            }
            
            // 获取代码上下文
            const contextInfo = this.contextAnalyzer.getContext(editor);
            
            // 记录当前位置 - 使用position参数确保我们获取正确位置的补全
            const lineText = document.lineAt(position.line).text;
            const linePrefix = lineText.substring(0, position.character);
            
            // 再次检查取消令牌
            if (token.isCancellationRequested) {
                this.resetPendingState();
                return null;
            }
            
            // 根据模式确定是获取单行还是代码段
            const completionMode = config.get<string>('completionMode', 'snippet');
            
            // 获取代码建议
            const suggestions = await this.getSuggestions(
                document, 
                position, 
                contextInfo, 
                completionMode,
                token
            );
            
            // 检查取消令牌和请求结果
            if (token.isCancellationRequested || !suggestions.length) {
                this.resetPendingState();
                return null;
            }
            
            // 构建内联补全项目
            const items = suggestions.map(suggestionText => {
                // 创建内联补全项目
                const item = new vscode.InlineCompletionItem(suggestionText, new vscode.Range(position, position));
                return item;
            });
            
            return items;
        } catch (error: any) {
            // 如果错误是由于请求取消，直接返回null
            if (error.message && error.message.includes('取消')) {
                log('请求已被取消');
                return null;
            }
            
            // 记录错误
            log(`内联补全错误: ${error}`);
            return null;
        } finally {
            // 无论成功或失败，确保重置状态
            this.resetPendingState();
        }
    }
    
    /**
     * 重置挂起状态
     */
    private resetPendingState(): void {
        this.pendingRequest = false;
        if (this.pendingRequestTimeout) {
            clearTimeout(this.pendingRequestTimeout);
            this.pendingRequestTimeout = null;
        }
    }
    
    /**
     * 获取代码建议
     * @param document 当前文档
     * @param position 光标位置
     * @param contextInfo 上下文信息
     * @param completionMode 补全模式
     * @param token 取消令牌
     * @returns 建议列表
     */
    private async getSuggestions(
        document: vscode.TextDocument,
        position: vscode.Position,
        contextInfo: ContextInfo,
        completionMode: string,
        token: vscode.CancellationToken
    ): Promise<string[]> {
        try {
            console.log(position)
            // 构建LLM提示
            const prompt = this.buildPrompt(contextInfo, completionMode);
            
            // 检查取消令牌
            if (token.isCancellationRequested) {
                return [];
            }
            
            // 记录请求开始
            log(`开始请求代码补全，模式: ${completionMode}`);
            
            // 调用LLM获取建议
            let suggestion = await this.llmConnector.getCompletion(prompt, token);
            
            // 请求完成后再次检查取消令牌
            if (token.isCancellationRequested) {
                log('请求完成但已被取消，丢弃结果');
                return [];
            }
            
            // 记录原始建议
            log(`收到原始建议: ${suggestion.substring(0, 100)}${suggestion.length > 100 ? '...' : ''}`);
            
            // 格式化建议
            // 处理单行模式 - 确保LLM只生成一行
            if (completionMode === 'line') {
                // 提取第一行非空代码
                const lines = suggestion.split('\n').map(line => line.trim()).filter(line => line.length > 0);
                suggestion = lines.length > 0 ? lines[0] : '';
                
                // 确保保持正确的缩进
                suggestion = this.codeFormatter.formatSingleLine(suggestion, contextInfo.indentation);
            } else {
                // 代码段模式 - 确保缩进正确
                suggestion = this.codeFormatter.formatCodeSnippet(suggestion, contextInfo.indentation);
            }
            
            // 应用代码风格
            suggestion = this.codeFormatter.applyCodeStyle(suggestion, document);
            
            // 记录格式化后的建议
            log(`格式化后的建议: ${suggestion.substring(0, 100)}${suggestion.length > 100 ? '...' : ''}`);
            
            return suggestion ? [suggestion] : [];
        } catch (error: any) {
            // 如果是取消请求，不显示错误
            if (error.message === '请求已取消' || token.isCancellationRequested) {
                log('获取建议时请求被取消');
                return [];
            }
            
            // 记录错误
            showError('获取补全建议失败', error);
            return [];
        }
    }
    
    /**
     * 构建LLM提示
     * @param contextInfo 上下文信息
     * @param completionMode 补全模式
     * @returns 提示字符串
     */
    private buildPrompt(contextInfo: ContextInfo, completionMode: string): string {
        // 获取配置
        const config = vscode.workspace.getConfiguration('llm-code-assistant');
        const apiProvider = config.get<string>('apiProvider') || 'openai';
        const modelName = config.get<string>('modelName') || 'gpt-4';
        
        // 基础系统提示
        let baseSystemPrompt = `你是一个专业的代码助手，根据代码上下文提供高质量的代码补全。
${completionMode === 'line' ? '请只生成一行代码，不要包含换行符。' : '请生成合适的代码片段。'}
请确保生成的代码与现有代码风格一致，并且语法正确。
不要包含解释，只返回代码本身。`;

        // 针对不同模型的特殊提示
        if (apiProvider === 'deepseek' && modelName.includes('deepseek-coder')) {
            baseSystemPrompt += '\n你是Deepseek Coder，专门为代码补全设计的模型，拥有强大的编程能力。';
        }

        // 构建上下文信息
        const contextPrompt = `文件: ${contextInfo.fileName}
语言: ${contextInfo.languageId}

上文代码:
${contextInfo.beforeCode}

当前行:
${contextInfo.beforeCursor}|光标位置|${contextInfo.afterCursor}

下文代码:
${contextInfo.afterCode}`;

        // 如果有检测到常见符号，添加到提示中
        if (contextInfo.symbolInfo && contextInfo.symbolInfo.length > 0) {
            const topSymbols = contextInfo.symbolInfo.slice(0, 15);
            const symbolsText = `附近的标识符: ${topSymbols.join(', ')}`;
            
            // 添加到提示末尾
            return `${baseSystemPrompt}

${contextPrompt}

${symbolsText}

${this.userPrompt ? `用户特别要求: ${this.userPrompt}` : config.get<string>('defaultPrompt') || '请根据上下文，在光标位置提供合适的代码补全。'}`;
        }

        // 添加用户提示（如果有）或默认提示
        const userPromptText = this.userPrompt ? 
            `用户特别要求: ${this.userPrompt}` : 
            config.get<string>('defaultPrompt') || '请根据上下文，在光标位置提供合适的代码补全。';

        // 合并提示
        return `${baseSystemPrompt}

${contextPrompt}

${userPromptText}`;
    }
}