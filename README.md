# Dev Notes Reader

在 VS Code 中阅读本地文本，支持代码行末随行阅读、状态栏和只读注释页。侧栏书架管理多本书，各自保存阅读进度和书签；通过原生图形设置调整阅读效果。

运行时无第三方依赖，不请求网络，不修改原书或你的代码文件。

## 功能

- **三种阅读模式**：代码行末显示 1–12 行正文，或切换为状态栏短句、独立注释页。
- **本地书架**：批量导入、继续阅读、查看进度和书签数、修改显示名称、定位原文件、移除记录。
- **章节与定位**：章节目录、上一章/下一章、全文搜索、百分比跳转、命名书签。
- **图形设置**：调整每行字数、显示行数、文本编码和失焦隐藏，无需修改 JSON。
- **快速隐藏**：清除阅读内容并遮住侧栏书名；重启后默认隐藏，主动恢复才显示。

## 安装

需要桌面版 VS Code **1.85.0 或更高版本**。支持本机 `.txt`、`.md`、`.text` 等纯文本文件，单文件最大 **20 MiB**。

从 [GitHub Releases](https://github.com/congim/dev-notes-reader/releases/latest) 下载 `dev-notes-reader-0.5.1.vsix`。在 VS Code 扩展视图的 `…` 菜单中选择 **从 VSIX 安装…**，选中下载的文件。当前尚未发布到 Marketplace。

从源码打包的文件位于 `dist/`，也可用命令安装：

```sh
code --install-extension ./dist/dev-notes-reader-0.5.1.vsix
```

已有用户升级后可按 VS Code 提示重新加载窗口。0.5.1 的显示名称统一为 **Dev Notes Reader**，扩展标识仍为 `local-dev-notes.dev-notes-reader`，原有设置、快捷键配置和书架记录继续使用。

## 三步开始阅读

1. 点击左侧 **Dev Notes Reader** 书本图标，选择 **打开本地书架**，再点 **＋** 批量加入本地文本。
2. 打开一个代码文件，在书架中点击书籍继续阅读。也可运行 **Dev Notes Reader: 导入并阅读本地文本**，一次导入并打开一本书。
3. 用下一页快捷键翻页；点击书架齿轮打开阅读设置。随行阅读默认 6 行，可改为 12 行，升级不会覆盖已有值。

书架右键菜单提供显示名称修改、文件定位和移除；移除只清除本书的阅读记录，原文件保留。

## 常用快捷键

macOS 中 `⌘` 为 Command、`⌥` 为 Option、`⌃` 为 Control。

| 操作 | Windows / Linux | macOS |
| --- | --- | --- |
| 打开本地书架 | Ctrl+Alt+L | ⌃⌥L |
| 导入并阅读本地文本 | Ctrl+Alt+N | ⌘⌥N |
| 开始随行阅读 | Ctrl+Alt+I | ⌃⌥I |
| 下一页 / 上一页 | Ctrl+Alt+→ / ← | ⌘⌥→ / ← |
| 显示 / 隐藏 | Ctrl+Alt+R | ⌘⌥R |
| 立即隐藏 | Ctrl+Alt+H | ⌃⌥H |
| 章节目录 | Ctrl+Alt+T | ⌃⌥T |
| 快捷操作 | Ctrl+Alt+K | ⌘⌥K |

发生冲突时，在 VS Code 的“键盘快捷方式”中搜索 `devNotes` 调整。完整命令、快捷键、设置和常见问题见[使用指南](docs/user-guide.md)。

## 限制与数据

- 支持本机纯文本；不支持 EPUB、PDF、压缩包或网络书源。Markdown 按纯文本显示。
- 章节按标题格式识别，非标准排版可能漏识别；长代码行、宽字符或折行可能影响行末对齐。
- 书架记录原文件路径，不复制正文；原文件移动后不会自动跟踪。修改内容后再次打开，会重置该书的进度和书签。
- 请在一个 VS Code 窗口内管理书架；多窗口同时修改记录尚无事务级合并。
- 目前在 macOS 验证。Windows/Linux、Remote/WSL、最低支持版本和辅助技术完整流程尚未实测。

本扩展没有网络请求或遥测。书籍路径、内容摘要、阅读位置和书签保存在 VS Code 的扩展全局存储中。隐藏是一种界面操作，不是安全隔离；详见[本地数据与隐私](docs/privacy.md)。

## 开发与文档

开发需要 Node.js **22.13.0+**、npm 和桌面版 VS Code。项目目录统一命名为 `dev-notes-reader`，无需编译：

```sh
npm ci
npm run verify
npm run test:integration
npm run test:persistence
npm run package
```

按 F5 启动 **Run Dev Notes Reader** 调试配置。`npm run package` 自动执行基础检查，生成 `dist/dev-notes-reader-<版本>.vsix`；构建产物与依赖目录不提交到 Git。

源码仓库：[congim/dev-notes-reader](https://github.com/congim/dev-notes-reader)。反馈问题请使用 [Issues](https://github.com/congim/dev-notes-reader/issues)，并提供版本、系统与复现步骤。

| 文档 | 内容 |
| --- | --- |
| [使用指南](docs/user-guide.md) | 阅读模式、书架、命令、设置、故障排查 |
| [开发指南](docs/development.md) | 目录、模块职责、开发约定、测试入口 |
| [测试说明](docs/testing.md) | 检查方式、验证基线、未覆盖项 |
| [提交与发布](docs/releasing.md) | Git 提交范围、版本管理、VSIX 和未来上架步骤 |
| [本地数据与隐私](docs/privacy.md) | 数据保存、清理方式、显示边界 |
| [更新日志](CHANGELOG.md) | 按版本记录的功能与维护变更 |

## 许可

[MIT](LICENSE)。仓库中的示例文本用于演示与测试；使用者自行准备要阅读的本地文件。
