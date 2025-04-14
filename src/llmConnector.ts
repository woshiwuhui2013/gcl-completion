import * as vscode from 'vscode';
import axios from 'axios';
import { OpenAI } from 'openai';

/**
 * 负责与LLM API进行通信
 */
export class LLMConnector {
    /**
     * 从Markdown文本中提取代码
     * @param text 可能包含Markdown格式的文本
     * @returns 提取的代码文本
     */
    private extractCodeFromMarkdown(text: string): string {
        // 检查是否有代码块
        const codeBlockRegex = /```(?:\w+)?\s*([\s\S]*?)```/g;
        const matches = [...text.matchAll(codeBlockRegex)];
        
        if (matches.length > 0) {
            // 如果有代码块，提取所有代码块的内容并连接
            return matches.map(match => match[1]).join('\n\n');
        }
        
        // 如果没有代码块，返回原文本
        return text;
    }

    /**
     * 发送请求到LLM获取代码补全
     * @param prompt 提示内容
     * @param cancellationToken 取消令牌
     * @returns 生成的代码字符串
     */
    public async getCompletion(
        prompt: string,
        cancellationToken?: vscode.CancellationToken
    ): Promise<string> {
        // 获取API配置
        const config = vscode.workspace.getConfiguration('llm-code-assistant');
        const apiProvider = config.get<string>('apiProvider') || 'openai';
        const apiKey = config.get<string>('apiKey') || '';
        
        if (!apiKey) {
            throw new Error('请在设置中配置API密钥');
        }
        
        // 根据不同的API提供商调用不同的方法
        switch (apiProvider.toLowerCase()) {
            case 'openai':
                return this.callOpenAI(prompt, apiKey, cancellationToken);
            case 'anthropic':
                return this.callAnthropic(prompt, apiKey, cancellationToken);
            case 'deepseek':
                return this.callDeepseek(prompt, apiKey, cancellationToken);
            default:
                throw new Error(`不支持的API提供商: ${apiProvider}`);
        }
    }
    
    /**
     * 调用OpenAI API
     * @param prompt 提示内容
     * @param apiKey API密钥
     * @param cancellationToken 取消令牌
     * @returns 生成的代码字符串
     */
    private async callOpenAI(
        prompt: string,
        apiKey: string,
        cancellationToken?: vscode.CancellationToken
    ): Promise<string> {
        try {
            // 获取模型配置
            const config = vscode.workspace.getConfiguration('llm-code-assistant');
            const modelName = config.get<string>('modelName') || 'gpt-4';
            const completionMode = config.get<string>('completionMode') || 'snippet';
            const customEndpoint = config.get<string>('apiEndpoint') || '';
            
            // 创建OpenAI客户端
            const openai = new OpenAI({
                apiKey: apiKey,
                baseURL: customEndpoint || undefined  // 如果提供了自定义端点则使用
            });
            
            // 设置取消处理
            const controller = new AbortController();
            if (cancellationToken) {
                cancellationToken.onCancellationRequested(() => {
                    controller.abort();
                });
            }
            
            // 构建系统提示，针对是单行还是代码段
            const systemPrompt = completionMode === 'line' 
                ? '你是一个专业的代码助手，能够提供高质量的代码补全。请只提供一行代码，不要添加任何解释或额外内容。确保代码风格一致。'
                : '你是一个专业的代码助手，能够提供高质量的代码补全和建议。请只返回代码片段，无需解释。确保代码风格一致。';
            
            // 调用API
            const response = await openai.chat.completions.create({
                model: modelName,
                messages: [
                    {
                        role: 'system',
                        content: systemPrompt
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.2, // 降低随机性，确保更一致的补全
                max_tokens: completionMode === 'line' ? 100 : 2000, // 单行模式限制token数
                top_p: 0.95,
                frequency_penalty: 0,
                presence_penalty: 0
            }, {
                signal: controller.signal
            });
            
            // 提取生成的代码
            const generatedText = response.choices[0]?.message?.content || '';
            
            // 处理代码块标记符
            return this.extractCodeFromMarkdown(generatedText);
        } catch (error: any) {
            if (error.name === 'AbortError') {
                throw new Error('请求已取消');
            }
            throw new Error(`OpenAI API 错误: ${error.message}`);
        }
    }
    
    /**
     * 调用Anthropic API
     * @param prompt 提示内容
     * @param apiKey API密钥
     * @param cancellationToken 取消令牌
     * @returns 生成的代码字符串
     */
    private async callAnthropic(
        prompt: string,
        apiKey: string,
        cancellationToken?: vscode.CancellationToken
    ): Promise<string> {
        try {
            // 获取模型配置
            const config = vscode.workspace.getConfiguration('llm-code-assistant');
            const modelName = config.get<string>('modelName') || 'claude-3-opus-20240229';
            const completionMode = config.get<string>('completionMode') || 'snippet';
            const customEndpoint = config.get<string>('apiEndpoint') || '';
            
            // 创建axios请求配置
            const controller = new AbortController();
            if (cancellationToken) {
                cancellationToken.onCancellationRequested(() => {
                    controller.abort();
                });
            }
            
            // 构建系统提示，针对是单行还是代码段
            const systemPrompt = completionMode === 'line' 
                ? '你是一个专业的代码助手，能够提供高质量的代码补全。请只提供一行代码，不要添加任何解释或额外内容。确保代码风格一致。'
                : '你是一个专业的代码助手，能够提供高质量的代码补全和建议。请只返回代码片段，无需解释。确保代码风格一致。';
            
            // 构建API URL - 使用自定义端点或默认端点
            const apiUrl = customEndpoint || 'https://api.anthropic.com/v1/messages';
            
            // 构建请求
            const response = await axios.post(
                apiUrl,
                {
                    model: modelName,
                    max_tokens: completionMode === 'line' ? 100 : 2000,
                    temperature: 0.2,
                    system: systemPrompt,
                    messages: [
                        {
                            role: 'user',
                            content: prompt
                        }
                    ]
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'anthropic-version': '2023-06-01',
                        'x-api-key': apiKey
                    },
                    signal: controller.signal
                }
            );
            
            // 提取生成的代码
            const generatedText = response.data.content[0]?.text || '';
            
            // 处理代码块标记符
            return this.extractCodeFromMarkdown(generatedText);
        } catch (error: any) {
            if (error.name === 'AbortError' || error.name === 'CanceledError') {
                throw new Error('请求已取消');
            }
            throw new Error(`Anthropic API 错误: ${error.message}`);
        }
    }
    
    /**
     * 调用Deepseek API
     * @param prompt 提示内容
     * @param apiKey API密钥
     * @param cancellationToken 取消令牌
     * @returns 生成的代码字符串
     */
    private async callDeepseek(
        prompt: string,
        apiKey: string,
        cancellationToken?: vscode.CancellationToken
    ): Promise<string> {
        try {
            // 获取模型配置
            const config = vscode.workspace.getConfiguration('llm-code-assistant');
            const modelName = config.get<string>('modelName') || 'deepseek-coder';
            const completionMode = config.get<string>('completionMode') || 'snippet';
            const customEndpoint = config.get<string>('apiEndpoint') || '';
            
            // 创建axios请求配置
            const controller = new AbortController();
            if (cancellationToken) {
                cancellationToken.onCancellationRequested(() => {
                    controller.abort();
                });
            }
            
            // 构建系统提示，针对是单行还是代码段
            const systemPrompt = completionMode === 'line' 
                ? '你是一个专业的代码助手，能够提供高质量的代码补全。请只提供一行代码，不要添加任何解释或额外内容。确保代码风格一致。'
                : '你是一个专业的代码助手，能够提供高质量的代码补全和建议。请只返回代码片段，无需解释。确保代码风格一致。';
            
            // 构建API URL - 使用自定义端点或默认端点
            const apiUrl = customEndpoint || 'https://api.deepseek.com/v1/chat/completions';
            
            // 根据模型选择实际的模型ID
            let actualModel = 'deepseek-coder';
            if (modelName === 'deepseek-chat') {
                actualModel = 'deepseek-chat';
            }
            
            // 构建请求体
            const requestBody = {
                model: actualModel,
                messages: [
                    {
                        role: 'system',
                        content: systemPrompt
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: 0.2,
                max_tokens: completionMode === 'line' ? 100 : 2000,
                top_p: 0.95,
                frequency_penalty: 0,
                presence_penalty: 0
            };
            
            // 发送请求
            const response = await axios.post(
                apiUrl,
                requestBody,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    signal: controller.signal
                }
            );
            
            // 提取生成的代码
            const generatedText = response.data.choices[0]?.message?.content || '';
            
            // 处理代码块标记符
            return this.extractCodeFromMarkdown(generatedText);
        } catch (error: any) {
            if (error.name === 'AbortError' || error.name === 'CanceledError') {
                throw new Error('请求已取消');
            }
            
            // 提取API错误信息
            let errorMessage = `Deepseek API 错误: ${error.message}`;
            if (error.response && error.response.data && error.response.data.error) {
                errorMessage = `Deepseek API 错误: ${error.response.data.error.message || error.message}`;
            }
            
            throw new Error(errorMessage);
        }
    }
}