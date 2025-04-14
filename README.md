# VSCode LLM代码补全助手

这是一个强大的VSCode插件，可以利用大型语言模型(LLM)来提供智能代码补全和推荐。通过分析当前代码的上下文，结合用户可选的提示语，插件能够生成高质量的代码补全建议，并直接显示在光标位置，保持与源代码风格一致。

## 功能特点

- **智能内联代码补全**: 基于当前代码上下文生成的代码建议直接显示在光标位置
- **单行/代码段模式**: 可配置生成单行代码或完整代码段
  - 单行模式：LLM只生成一行代码
  - 代码段模式：LLM生成多行代码片段
- **格式自动适配**: 自动匹配源代码的缩进和格式风格
- **多模型支持**: 支持多种LLM提供商和API
  - OpenAI (GPT-3.5/GPT-4)
  - Anthropic (Claude)
  - Deepseek (Deepseek Coder/Chat)
- **快捷键支持**: 通过快捷键快速触发代码补全
- **可选用户提示**: 用户可以输入自定义提示语来进一步引导生成过程

## 安装

1. 打开VSCode
2. 进入扩展市场
3. 搜索"LLM代码补全助手"
4. 点击安装

## 使用方法

### 基本使用

1. 在编辑器中，将光标放置到你希望插入代码的位置
2. 使用快捷键 `Ctrl+Shift+L` (Windows/Linux) 或 `Cmd+Shift+L` (Mac) 触发代码补全
3. 系统会分析代码上下文并自动生成代码建议
4. 代码建议将以灰色文本的形式直接显示在光标位置
5. 按下 `Tab` 键接受建议，或按 `Esc` 键拒绝

### 使用自定义提示

1. 使用快捷键 `Ctrl+Shift+L` (Windows/Linux) 或 `Cmd+Shift+L` (Mac) 触发代码补全
2. 在弹出的输入框中输入你的需求描述（例如："实现一个排序函数"）
3. 按回车键，系统会结合你的提示和代码上下文生成建议

### 配置选项

在VSCode设置中，你可以找到"LLM代码补全助手"部分，包含以下配置：

- **API提供商**: 选择你使用的LLM提供商
  - OpenAI: 使用GPT模型
  - Anthropic: 使用Claude模型
  - Deepseek: 使用Deepseek模型
- **API密钥**: 设置对应提供商的API密钥
- **API端点**: (可选) 设置自定义API端点URL，如果使用自托管或代理服务
- **补全模式**: 
  - `单行`: LLM只生成一行代码
  - `代码段`: LLM生成多行代码片段
- **代码上下文行数**: 设置分析代码上下文的行数范围（默认前后各50行）
- **自动建议**: 启用/禁用自动显示代码建议（无需手动触发）
- **模型选择**: 选择使用的模型版本
  - GPT-3.5 Turbo
  - GPT-4
  - GPT-4 Turbo
  - Claude 3 Opus
  - Claude 3 Sonnet
  - Deepseek Coder (专为代码优化)
  - Deepseek Chat
- **默认提示**: 设置当用户没有输入提示时使用的默认提示

## 命令

插件提供以下VSCode命令:

- `llm-code-assistant.triggerCompletion`: 触发代码补全（可输入自定义提示）
- `llm-code-assistant.toggleCompletionMode`: 在单行和代码段模式之间切换

## 技术实现

本插件使用VSCode的`InlineCompletionItemProvider` API实现内联代码补全，主要包含以下模块：

1. **上下文分析器**: 负责分析当前编辑器的代码上下文
2. **LLM连接器**: 与LLM API进行通信
3. **代码格式化器**: 确保生成的代码与源代码风格一致
4. **内联补全提供者**: 协调各模块并提供内联补全建议

## 项目结构

```
vscode-llm-code-assistant/
├── package.json            # 插件配置和依赖
├── src/                    # 源代码
│   ├── extension.ts        # 插件入口
│   ├── contextAnalyzer.ts  # 上下文分析模块
│   ├── llmConnector.ts     # LLM API连接模块
│   ├── codeFormatter.ts    # 代码格式化模块
│   ├── inlineCompletionProvider.ts # 内联补全提供模块
│   └── utils/              # 工具函数
├── test/                   # 测试代码
└── README.md               # 项目说明文档
```

## 常见问题

**Q: 代码建议没有显示？**  
A: 请确保你已配置正确的API密钥，并且API提供商可以正常访问。

**Q: 如何获取API密钥?**  
A: 请访问你选择的LLM提供商官网，注册并获取API密钥。

**Q: 单行模式和代码段模式有什么区别?**  
A: 单行模式会让LLM只生成一行代码；代码段模式则会生成多行代码片段。

**Q: 插件支持哪些编程语言?**  
A: 插件支持VSCode支持的所有主要编程语言，但效果可能因语言而异。

## 许可证

MIT

## 更新日志

### v1.1.0
- 添加对 Deepseek 模型的支持
- 支持自定义 API 端点
- 改进代码格式处理
- 优化针对不同模型的提示

### v1.0.0
- 初始版本发布
- 支持内联代码补全功能
- 支持单行/代码段模式
- 支持OpenAI和Anthropic API

## 贡献

欢迎通过Issues和Pull Requests贡献代码和想法！

## 联系方式

如有问题或建议，请通过GitHub Issues提交。码与源代码风格一致
4. **用户界面**: 实现交互式提示输入和建议展示

## 开发指南

### 构建步骤

1. 克隆仓库
2. 安装依赖: `npm install`
3. 编译项目: `npm run compile`
4. 打包插件: `npm run package`

### 调试插件

1. 在VSCode中打开项目文件夹
2. 按下F5启动调试会话
3. 在新的VSCode窗口中测试插件功能

### 添加新功能

如果你想为插件添加新功能，可以按照以下步骤进行：

1. 修改相应的模块代码
2. 更新配置选项（如需要）
3. 在 `extension.ts` 中注册新命令或功能
4. 编译并测试插件

## 使用不同的模型

### OpenAI 模型

OpenAI的模型适合广泛的代码补全任务：
- GPT-3.5 Turbo: 速度快，成本低，适合简单的代码补全
- GPT-4: 代码理解和生成能力更强，适合复杂任务
- GPT-4 Turbo: 最新版本，兼顾性能和速度

### Anthropic Claude 模型

Claude模型在理解长上下文和生成复杂代码方面表现出色：
- Claude 3 Opus: 最强大的Claude模型，适合复杂编程任务
- Claude 3 Sonnet: 平衡性能和速度的中端模型

### Deepseek 模型

Deepseek提供专为代码优化的模型：
- Deepseek Coder: 专门为代码补全和生成优化的模型，支持多种编程语言
- Deepseek Chat: 通用对话模型，也可用于代码生成

**使用Deepseek模型的步骤：**
1. 注册[Deepseek平台](https://deepseek.com)获取API密钥
2. 在VS Code设置中选择"Deepseek"作为API提供商
3. 输入你的API密钥
4. 选择合适的Deepseek模型
5. 如果使用自定义端点，可以在"API端点"设置中指定

## 自定义API端点

如果你使用代理服务或自托管模型，可以在设置中指定自定义API端点。留空则使用官方默认端点。

通过使用VSCode的`InlineCompletionItemProvider` API，代码建议能够无缝集成到编辑体验中，提供类似原生代码补全的用户体验。

## 性能优化

为了提高插件性能和用户体验，我们采取了以下措施：

1. **节流请求**：避免在短时间内发送过多请求
2. **缓存结果**：缓存常见场景的补全结果
3. **智能触发**：根据上下文智能决定是否触发补全
4. **轻量级上下文分析**：优化上下文分析算法，减少内存占用

## 隐私说明

本插件会将代码上下文发送到配置的LLM API进行处理。请注意：

1. 只有光标周围的代码会被发送，不会发送整个项目
2. 所有数据处理遵循你选择的LLM提供商的隐私政策
3. 插件不会存储或共享你的代码
4. API密钥仅存储在本地配置中，不会被发送到其他地方