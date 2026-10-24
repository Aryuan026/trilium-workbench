# Trilium 工作台

基于 [Trilium Notes](https://github.com/TriliumNext/Trilium) 的工作台扩展，为不同办公场景准备固定入口、资料页面与可恢复的工作区。荧小助学生管理是第一个范例工作包。

## 已完成

以下只记录完成后的功能节点。后续完成一项补一条，中间的调色、间距调整和调试过程不作为更新记录。

- **工作台宿主**：添加了本地工作包安装、启用和停用；停用与重新安装保留已有资料。
- **快捷导航**：添加了工作台固定入口、首字或图标选择、排序、展开子页和常用工具自选。
- **整体界面**：添加了统一紧凑字号、三栏对齐，以及暖石色侧栏、鼠尾草绿选中态和白色正文分区。
- **荧小助范例**：添加了合成学生资料、搜索首页与 Trilium 原生电子表格，首页读取同一份表格。
- **工作准备**：添加了资料准备标记和外部辅助 AI 使用指引。
- **备份恢复**：添加了独立工作区、退出时保存完整备份，以及从备份恢复到新目录。
- **上游适配**：跟进官方 Trilium **0.106.1**，工作台入口为 **0.4.0**，添加了本机内核位置记忆。
- **资料查找**：添加了按工作台、表格、文档和附件分类的日常查找页；查询复用原生搜索，源码配置收进高级技术资料。
- **搜索范围**：添加了默认排除工作台内资料的日常查找，可勾选包含工作台资料，无需填写高级搜索语法。
- **阅读预览**：添加了统一的笔记悬浮预览、全文标题排版与紧凑搜索控件，说明文档按段落和步骤呈现。
- **本机业务接入**：添加了独立业务包自动启动、受限页面转接、保存退出和资料库与业务状态成对恢复；荧小助名册与设备权限已通过合成服务验证。

## 当前使用范围

当前为 **Apple Silicon / macOS 13+** 的本地原型，使用合成资料；本机业务包接入已验证，真实学生同步与 AI 连接尚未接入。Windows、实体第二设备恢复和自包含安装包尚未交付。

工作台调用本机的官方 Trilium **0.106.1**，不包含修改后的 Trilium 二进制。先从[官方发布页](https://github.com/TriliumNext/Trilium/releases/tag/v0.106.1)下载安装，再构建本项目：

```sh
node tools/build-launcher.cjs
```

双击生成的 `outputs/Trilium 工作台.app`，新建、打开工作区或从备份恢复；首次选择官方应用后会记住其位置。入口为本地临时签名，未做 Apple 公证。应用内选择“安装本地工作包”，导入生成的 `outputs/packages/ying-students.json` 即可使用范例。

所选工作区文件夹保存完成的备份；活跃数据库与机器配置留在本机。换机前先保存退出，等待启动器保存完成，再同步备份。

连接另行安装的业务包时，在工作区选择窗口勾选“连接本机已安装的业务工作包”，选择该包提供的可信连接文件。之后打开工作区会自动启动服务，无需另开终端；可离线查看已保存在本机的资料。

业务工作区请使用页面上的“保存并退出工作区”。启动器先等待已提交操作结束，再同时保存数据库与业务状态；恢复时选择 **workspace.json** 和新的空文件夹，保留整个工作区备份目录。本机业务程序须另行安装并连接同版本；仅恢复 `.db` 会被拒绝。直接退出 Trilium 时，未确认操作仍需重开核对。

连接文件只保存在本机，声明程序参数、允许的 GET/POST 路径、请求上限和需备份的状态文件；`$runtime`、`$state` 引用由启动器填入本机路径与临时连接参数。公开仓只提供通用宿主，业务源码、连接文件、身份映射和凭据不随仓库分发。

## 源码与检查

`src/` 为工作台与范例，`native/` 为 Swift/AppKit 入口，`tools/` 为构建和检查工具。构建使用系统 Swift、SQLite 与 Node.js；浏览器检查另需可用的 Playwright 模块，可通过 `PLAYWRIGHT_MODULE` 指定路径。

```sh
node tools/check-install.cjs
node tools/check-external.cjs
TRILIUM_APP="/path/to/Trilium Notes.app" node tools/check-recovery.cjs
python3 tools/check-backup.py --recovery
python3 tools/check-backup.py --business /path/to/workspace.json
```

## 来源与许可

上游作者为 Trilium Notes Team 及 Trilium / TriliumNext 贡献者。上游与本项目扩展源码均按 **AGPL-3.0-only** 提供，见 [LICENSE](LICENSE) 与 [NOTICE.md](NOTICE.md)。对应上游源码和构建材料见 [v0.106.1](https://github.com/TriliumNext/Trilium/tree/v0.106.1)。
