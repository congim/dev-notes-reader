# 开发指南

## 环境与启动

- Node.js 22.13.0 或更高版本、npm。
- 桌面版 VS Code；扩展声明的兼容下限为 1.85.0，实测环境见[测试说明](testing.md)。
- JavaScript / CommonJS，无编译步骤，无运行时第三方依赖。

```sh
npm ci
npm run verify
```

在 VS Code 打开 `dev-notes-reader` 文件夹，按 F5，选择 **Run Dev Notes Reader**。需要体验时，在开发宿主打开 `test/fixtures/work-sample.ts`，导入 `test/fixtures/story.txt`。示例文件不是插件运行依赖，不会装入 VSIX。

## 目录

```text
dev-notes-reader/
├── .vscode/launch.json            # 扩展开发宿主启动配置
├── docs/                         # 使用、开发、测试、发布与数据说明
├── media/activitybar-books.svg   # 活动栏图标
├── scripts/
│   ├── test-extension.js         # 独立配置下启动 Extension Host 测试
│   └── test-persistence.js       # 两进程读写与落盘验证
├── src/
│   ├── extension.js              # 命令、生命周期、显示、导入和保存
│   ├── book.js                   # 解码、分页、章节、搜索与位置处理
│   ├── library.js                # 书架、独立进度、书签及存储迁移
│   ├── inline-layout.js          # 可见行选择与行末对齐计算
│   └── bookshelf-provider.js     # 原生书架树、文件状态与隐藏
├── test/
│   ├── unit/                    # 不启动 VS Code 的纯逻辑测试
│   ├── integration/
│   │   ├── extension.test.js     # Extension Host 中运行的测试套件
│   │   └── persistence-driver/   # 仅供持久化测试使用的驱动扩展
│   └── fixtures/                # 演示与测试文本、代码样本
├── CHANGELOG.md
├── LICENSE
├── README.md
├── package.json
└── package-lock.json
```

`node_modules/`、`dist/` 和 `.vscode-test/` 是本地生成目录，已由 `.gitignore` 排除。旧版本安装包和开发过程草稿不进入源码仓库。

## 开发命令

| 命令 | 用途 |
| --- | --- |
| `npm ci` | 按锁文件安装开发依赖 |
| `npm run check` | 检查运行时代码、测试启动器和宿主测试脚本语法 |
| `npm test` | 运行 `test/unit/` 下三个单元测试文件 |
| `npm run verify` | 语法检查及全部单元测试 |
| `npm run test:integration` | 启动隔离 Extension Host 并运行命令与界面 API 测试 |
| `npm run test:persistence` | 启动两次普通开发宿主并检查实际持久化 |
| `npm run package:contents` | 列出将进入 VSIX 的文件 |
| `npm run package` | 创建 `dist/`，执行打包前检查，生成本地 VSIX |

`vscode:prepublish` 是 VSCE 的打包前钩子，本项目用它运行 `verify`，不会自动发布插件。`package.json` 的 `private: true` 防止误发到 npm，不影响 VSIX 打包。

## 命名与格式

- 项目文件夹、npm 包名：`dev-notes-reader`；用户可见产品名称：**Dev Notes Reader**。
- 普通目录和模块文件采用小写 `kebab-case`；文档入口使用常见的 `README.md`、`CHANGELOG.md`、`LICENSE`。
- 变量与函数采用 `camelCase`，类采用 `PascalCase`，常量采用 `UPPER_SNAKE_CASE`。
- JavaScript 使用 CommonJS、单引号、分号和两个空格缩进；JSON 用两个空格缩进。
- `.editorconfig` 与 `.gitattributes` 统一 UTF-8、LF 和文件结尾换行。
- 沿用现有模块职责；注释说明原因或已知边界，不复述代码。

新增源文件或测试文件时，同步维护 `check` / `test` 脚本和打包清单。没有引入格式化框架或运行时依赖。

## 兼容性边界

以下名称属于现有用户配置或数据协议，不能当作普通显示文案随意修改：

| 标识 | 用途 |
| --- | --- |
| `local-dev-notes.dev-notes-reader` | 当前扩展 ID，来自 publisher 与 name |
| `devNotes.*` | 命令 ID、配置键与上下文键 |
| `dev-notes:/review-notes.ts` | 虚拟阅读文档 |
| `readingLibrary` | 当前书架存储键，快照版本为 2 |
| `lastReading` | 旧版迁移读取键，迁移成功后清除 |

显示名称和文件路径重命名不改变这些协议。修改 publisher 或扩展 name 会改变扩展身份，需要另行设计旧数据迁移；当前还在使用本地 publisher，不代表已注册 Marketplace 身份。

## 修改与验证原则

阅读位置使用原文 UTF-16 字符偏移，重新排版时按偏移定位；内容摘要改变后重置该书位置和书签。持久化串行写入深拷贝快照，避免后续操作改动待写数据。异步导入、模式切换和选择器使用代数标记检查取消，“立即隐藏”必须优先。

修改这些行为时，使用现有单元测试和宿主测试复现问题并覆盖边界。不要在日志、报错或测试产物中输出正文；不要使用真实书架数据作为自动测试夹具。自动测试使用临时用户配置，正常退出后清理自身目录。

依赖通过 `package-lock.json` 固定。现有 `@azure/msal-node` override 用于约束 VSCE 的间接开发依赖；升级时重新检查依赖与打包工具，而非直接删除覆盖项。
