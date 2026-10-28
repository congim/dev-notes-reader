# Git 提交与发布

## 当前交付范围

当前项目名为 `dev-notes-reader`，显示名称为 **Dev Notes Reader**，版本为 **0.5.1**。源码仓库为 [congim/dev-notes-reader](https://github.com/congim/dev-notes-reader)，主分支为 `main`，通过 [GitHub Releases](https://github.com/congim/dev-notes-reader/releases) 分发 VSIX。目前未发布到 Marketplace，正式 Marketplace publisher 尚未配置。

`local-dev-notes` 沿用已有本地扩展身份。不能据此认定拥有同名 Marketplace publisher 的发布权限，也不要用虚构的 repository、主页或反馈地址占位。

## 提交 Git

应提交：`src/`、`media/`、`scripts/`、`test/`、`docs/`、`.vscode/launch.json`、`.editorconfig`、`.gitattributes`、`.gitignore`、`package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md` 与 `LICENSE`。

不提交：`node_modules/`、`dist/`、`*.vsix`、测试缓存、日志和用户私有文件。上述生成物由 `.gitignore` 排除。安装包可在后续版本的 Release 附件中单独分发。

从已有仓库开始开发：

```sh
git clone https://github.com/congim/dev-notes-reader.git
cd dev-notes-reader
```

完成修改和验证后，检查待提交内容：

```sh
git add .
git status --short
git diff --cached --stat
```

确认暂存列表后再提交到 `main` 或通过功能分支发起 Pull Request。源码中的相对文档链接在仓库里可以直接浏览。

## 本地打包

```sh
npm ci
npm run verify
npm run test:integration
npm run test:persistence
npm run package:contents
npm run package
```

输出为 `dist/dev-notes-reader-0.5.1.vsix`。打包前的 `vscode:prepublish` 钩子自动执行基础检查；宿主与跨进程测试需要单独执行。

`package.json.files` 是唯一打包白名单：运行时源码、图标、正式 Markdown 文档、README、更新日志和许可。不维护重复的 `.vscodeignore`；测试、脚本、锁文件与个人截图不会进入 VSIX。

`npm run package` 使用真实仓库地址和 `main` 分支重写 README、更新日志中的相对链接。它只生成本地文件，不上传到 GitHub 或 Marketplace，也不修改扩展版本。

安装验证：

```sh
code --install-extension ./dist/dev-notes-reader-0.5.1.vsix
```

按 VS Code 提示重新加载后检查扩展名称、书架、设置入口及现有记录恢复。卸载或安装旧版本不应被当作删除用户数据的手段。

## 版本管理

小范围文档、目录或修复使用 patch 版本；新功能使用 minor；不兼容变化使用 major。更新 `package.json` 和 `package-lock.json` 的版本，并在 `CHANGELOG.md` 添加日期与实际变化。例如下次修订可执行：

```sh
npm version patch --no-git-tag-version
```

然后同步 README 的安装示例、使用指南与本文件中的版本号，重新验证和打包。历史安装包由 GitHub Release 管理，不放回源码根目录。

## 发布 GitHub Release

使用已通过验证、工作区干净的提交。先推送源码，再创建与 `package.json.version` 一致的 `v<版本>` 标签；不要移动已发布标签或覆盖已有版本的附件。

以下以 0.5.1 为例，仅在该版本尚未发布时执行。先在 `dist/release-notes-v0.5.1.md` 写好发布说明；安装方式、实际验证结果和已知限制都应列出。macOS 可用 `shasum -a 256` 生成校验文件：

```sh
git push origin main
git tag -a v0.5.1 -m "Dev Notes Reader v0.5.1"
git push origin v0.5.1
cd dist
shasum -a 256 dev-notes-reader-0.5.1.vsix > SHA256SUMS.txt
gh release create v0.5.1 dev-notes-reader-0.5.1.vsix SHA256SUMS.txt \
  --repo congim/dev-notes-reader --verify-tag \
  --title "Dev Notes Reader v0.5.1" --notes-file release-notes-v0.5.1.md
cd ..
```

GitHub CLI 需事先通过 `gh auth login` 登录并具备该仓库的写入权限。发布后核对标签指向、附件版本和 SHA-256；发布说明中的测试结果以实际执行为准。下载者可在附件所在目录运行 `shasum -a 256 -c SHA256SUMS.txt` 检查完整性。

## 未来上架 Marketplace

上架前还需要维护者完成：

1. 确认正式 publisher 权限与扩展 ID。若改变 publisher/name，先处理本地旧版本的配置和数据迁移，不能只改元数据。
2. 复核已配置的 repository、主页和反馈地址。需要品牌图标时，另准备符合官方要求的 PNG；现有 SVG 用于活动栏。
3. 补充公开演示素材。当前清理掉了历史个人桌面截图，未把测试截图作为商店宣传材料。
4. 复核测试矩阵与已知限制，确认版本、更新日志和许可一致。
5. 使用 `npm run package` 重新打包并检查安装包中的文档链接；GitHub Release 发布成功不代表已经完成 Marketplace 审核。

完成元数据后，可在已有 `dist/` 目录下执行本地 VSCE：

```sh
npm run package
```

确认产物后，由发布者按官方流程认证并上传。凭据不写入源码、npm scripts、README 或版本控制。

官方参考：[发布扩展与 VSIX 打包](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)、[扩展清单](https://code.visualstudio.com/api/references/extension-manifest)。
