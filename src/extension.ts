import * as vscode from 'vscode';
import { ContextAnalyzer } from './contextAnalyzer';
import { LLMConnector } from './llmConnector';
import { CodeFormatter } from './codeFormatter';
import { InlineCompletionProvider } from './inlineCompletionProvider';
import { PromptBuilder } from './promptBuilder';
import { log, showError, isApiConfigValid, promptForApiConfig } from './utils';

/**
 * 插件激活时调用
 * @param context 插件上下文
 */
export function activate(context: vscode.ExtensionContext) {
    log('LLM代码补全助手插件已激活');

    // 创建核心组件
    const contextAnalyzer = new ContextAnalyzer();
    const llmConnector = new LLMConnector();
    const codeFormatter = new CodeFormatter();
    
    // 注册内联代码补全提供者
    const inlineCompletionProvider = new InlineCompletionProvider(
        contextAnalyzer,
        llmConnector,
        codeFormatter
    );

    // 注册内联代码补全
    const inlineCompletionProviderDisposable = vscode.languages.registerInlineCompletionItemProvider(
        { pattern: '**' }, // 支持所有文件类型
        inlineCompletionProvider
    );

    // 注册触发代码补全命令 - 用户可以手动触发
    const triggerCompletionCommand = vscode.commands.registerCommand(
        'llm-code-assistant.triggerCompletion',
        async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('请先打开一个文件');
                return;
            }

            // 验证API配置
            if (!isApiConfigValid()) {
                await promptForApiConfig();
                return;
            }

            // 获取用户提示（可选）
            const promptText = await vscode.window.showInputBox({
                prompt: '请输入代码补全提示（可选）',
                placeHolder: '例如：实现一个排序函数'
            });

            // 触发内联补全
            try {
                await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
                
                // 如果用户提供了提示，我们需要将其传递给内联补全提供者
                if (promptText) {
                    inlineCompletionProvider.setUserPrompt(promptText);
                }
            } catch (error) {
                showError('触发内联补全失败', error);
            }
        }
    );

    // 注册切换补全模式命令
    const toggleCompletionModeCommand = vscode.commands.registerCommand(
        'llm-code-assistant.toggleCompletionMode',
        () => {
            const config = vscode.workspace.getConfiguration('llm-code-assistant');
            const currentMode = config.get<string>('completionMode');
            const newMode = currentMode === 'line' ? 'snippet' : 'line';
            
            config.update('completionMode', newMode, vscode.ConfigurationTarget.Global)
                .then(() => {
                    vscode.window.showInformationMessage(
                        `已切换到${newMode === 'line' ? '单行' : '代码段'}模式`
                    );
                });
        }
    );

    // 将命令和提供者添加到上下文
    context.subscriptions.push(
        inlineCompletionProviderDisposable,
        triggerCompletionCommand,
        toggleCompletionModeCommand
    );
}

// 插件停用时调用
export function deactivate() {
    log('LLM代码补全助手插件已停用');
}