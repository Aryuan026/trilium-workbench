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
- **上游适配**：跟进官方 Trilium **0.106.1**，工作台入口为 **0.3.2**，添加了本机内核位置记忆。
- **资料查找**：添加了按工作台、表格、文档和附件分类的日常查找页；查询复用原生搜索，源码配置收进高级技术资料。
- **搜索范围**：添加了默认排除工作台内资料的日常查找，可勾选包含工作台资料，无需填写高级搜索语法。
- **阅读预览**：添加了统一的笔记悬浮预览、全文标题排版与紧凑搜索控件，说明文档按段落和步骤呈现。

## 当前使用范围

当前为 **Apple Silicon / macOS 13+** 的本地原型，使用合成资料；真实学生同步与 AI 连接尚未接入。Windows、第二设备恢复和自包含安装包尚未交付。

工作台调用本机的官方 Trilium **0.106.1**，不包含修改后的 Trilium 二进制。先从[官方发布页](https://github.com/TriliumNext/Trilium/releases/tag/v0.106.1)下载安装，再构建本项目：

```sh
node tools/build-launcher.cjs
```

双击生成的 `outputs/Trilium 工作台.app`，新建、打开工作区或从备份恢复；首次选择官方应用后会记住其位置。入口为本地临时签名，未做 Apple 公证。应用内选择“安装本地工作包”，导入生成的 `outputs/packages/ying-students.json` 即可使用范例。

所选工作区文件夹保存完成的备份；活跃数据库与机器配置留在本机。换机前先退出 Trilium，等待启动器保存完成，再同步备份。

## 源码与检查

`src/` 为工作台与范例，`native/` 为 Swift/AppKit 入口，`tools/` 为构建和检查工具。构建使用系统 Swift、SQLite 与 Node.js；浏览器检查另需可用的 Playwright 模块，可通过 `PLAYWRIGHT_MODULE` 指定路径。

```sh
node tools/check-install.cjs
TRILIUM_APP="/path/to/Trilium Notes.app" node tools/check-recovery.cjs
python3 tools/check-backup.py --recovery
```

## 来源与许可

上游作者为 Trilium Notes Team 及 Trilium / TriliumNext 贡献者。上游与本项目扩展源码均按 **AGPL-3.0-only** 提供，见 [LICENSE](LICENSE) 与 [NOTICE.md](NOTICE.md)。对应上游源码和构建材料见 [v0.106.1](https://github.com/TriliumNext/Trilium/tree/v0.106.1)。
