import * as vscode from 'vscode';

/**
 * 显示错误消息并记录到输出控制台
 * @param message 错误消息
 * @param error 错误对象
 */
export function showError(message: string, error?: any): void {
    // 创建详细错误消息
    let detailedMessage = message;
    if (error) {
        detailedMessage += `: ${error.message || error}`;
    }
    
    // 显示错误消息
    vscode.window.showErrorMessage(detailedMessage);
    
    // 记录到输出控制台
    const outputChannel = getOutputChannel();
    outputChannel.appendLine(`[错误] ${detailedMessage}`);
    if (error && error.stack) {
        outputChannel.appendLine(error.stack);
    }
}

/**
 * 记录信息到输出控制台
 * @param message 消息
 */
export function log(message: string): void {
    const outputChannel = getOutputChannel();
    const timestamp = new Date().toISOString();
    outputChannel.appendLine(`[${timestamp}] [信息] ${message}`);
}

/**
 * 记录警告到输出控制台
 * @param message 警告消息
 */
export function warn(message: string): void {
    const outputChannel = getOutputChannel();
    const timestamp = new Date().toISOString();
    outputChannel.appendLine(`[${timestamp}] [警告] ${message}`);
}

/**
 * 记录调试信息到输出控制台
 * 仅在调试模式下显示
 * @param message 调试消息
 */
export function debug(message: string): void {
    // 检查是否启用了调试模式
    const config = vscode.workspace.getConfiguration('llm-code-assistant');
    const isDebugMode = config.get<boolean>('debugMode', false);
    
    if (isDebugMode) {
        const outputChannel = getOutputChannel();
        const timestamp = new Date().toISOString();
        outputChannel.appendLine(`[${timestamp}] [调试] ${message}`);
    }
}

/**
 * 获取或创建输出控制台
 * @returns 输出控制台
 */
let outputChannel: vscode.OutputChannel | undefined;
export function getOutputChannel(): vscode.OutputChannel {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel('LLM代码补全助手');
    }
    return outputChannel;
}

/**
 * 检查API配置是否有效
 * @returns 是否有效
 */
export function isApiConfigValid(): boolean {
    const config = vscode.workspace.getConfiguration('llm-code-assistant');
    const apiKey = config.get<string>('apiKey') || '';
    
    return apiKey.length > 0;
}

/**
 * 提示用户设置API配置
 */
export async function promptForApiConfig(): Promise<void> {
    const action = await vscode.window.showInformationMessage(
        '请先配置LLM代码补全助手的API密钥',
        '打开设置'
    );
    
    if (action === '打开设置') {
        await vscode.commands.executeCommand(
            'workbench.action.openSettings',
            'llm-code-assistant.apiKey'
        );
    }
}

/**
 * 延迟函数
 * @param ms 毫秒数
 * @returns Promise
 */
export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 安全地处理异步操作
 * @param promise Promise
 * @returns 结果或错误对象
 */
export async function safeAsync<T>(promise: Promise<T>): Promise<[T | null, Error | null]> {
    try {
        const result = await promise;
        return [result, null];
    } catch (error) {
        return [null, error as Error];
    }
}

/**
 * 获取编辑器选择的文本
 * @param editor 编辑器
 * @returns 选择的文本或null
 */
export function getSelectedText(editor: vscode.TextEditor): string | null {
    if (!editor.selection.isEmpty) {
        return editor.document.getText(editor.selection);
    }
    return null;
}

/**
 * 检测编程语言类型
 * @param languageId 语言ID
 * @returns 语言类别
 */
export function detectLanguageCategory(languageId: string): 'scripting' | 'compiled' | 'markup' | 'other' {
    const scriptingLanguages = ['javascript', 'typescript', 'python', 'ruby', 'perl', 'php', 'lua'];
    const compiledLanguages = ['java', 'cpp', 'c', 'csharp', 'go', 'rust', 'swift', 'kotlin'];
    const markupLanguages = ['html', 'xml', 'markdown', 'css', 'scss', 'less', 'json', 'yaml'];
    
    if (scriptingLanguages.includes(languageId)) {
        return 'scripting';
    } else if (compiledLanguages.includes(languageId)) {
        return 'compiled';
    } else if (markupLanguages.includes(languageId)) {
        return 'markup';
    } else {
        return 'other';
    }
}

/**
 * 格式化错误对象为可读字符串
 * @param error 错误对象
 * @returns 格式化的错误字符串
 */
export function formatError(error: any): string {
    if (!error) {
        return '未知错误';
    }
    
    // 处理常见错误类型
    if (error instanceof Error) {
        // 标准Error对象
        return `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`;
    } else if (typeof error === 'string') {
        // 字符串错误
        return error;
    } else if (error.isAxiosError) {
        // Axios错误
        const response = error.response;
        if (response) {
            return `请求错误(${response.status}): ${response.statusText || '未知错误'}\n${
                response.data && response.data.error ? response.data.error.message || JSON.stringify(response.data.error) : ''
            }`;
        } else {
            return `网络错误: ${error.message || '连接失败'}`;
        }
    } else {
        // 其他类型错误
        try {
            return JSON.stringify(error, null, 2);
        } catch (e) {
            return String(error);
        }
    }
}

/**
 * 检查VSCode是否在Windows上运行
 * @returns 是否是Windows平台
 */
export function isWindows(): boolean {
    return process.platform === 'win32';
}

/**
 * 清理路径分隔符，确保在不同平台上正确
 * @param path 路径
 * @returns 标准化的路径
 */
export function cleanPath(path: string): string {
    return isWindows() ? path.replace(/\//g, '\\') : path.replace(/\\/g, '/');
}