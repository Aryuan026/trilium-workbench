const host = api.$container[0];
const entries = JSON.parse(await (await api.getNote("twCatalogData")).getContent());
const installSource = await (await api.getNote("twInstaller")).getContent();
host.innerHTML = `<main class="tw"><p class="tw-eyebrow">我的工作区 / 工作台目录</p><h1>把需要的工作，放在手边。</h1><p class="tw-lead">按需启用，资料留在自己的工作区。打开工作台就能开始。</p><div class="tw-banner">合成资料原型 · 辅助 AI 尚未连接 · 真实学生同步未连接</div><div class="tw-toolbar"><span>本地工作包</span><button class="tw-import">安装本地工作包</button><input class="tw-file" type="file" accept=".json,application/json" hidden></div><section class="tw-catalog"></section><footer><button class="tw-backup">创建完整备份</button><p class="tw-backup-result" aria-live="polite"></p><p>原生备份先保存在本机。通过工作台启动器打开时，退出 Trilium（⌘Q）后会把完整备份保存到你选择的工作区位置。</p><p>辅助 AI：尚未连接。工作包中的指引可交给 WorkBuddy 等外部工具，日常查询和表格编辑照常可用。</p>基于 Trilium Notes · 工作包与个人资料分开保存</footer></main>`;
const input = host.querySelector('.tw-file');
const customize = document.createElement('button'); customize.textContent = '自定义侧栏';
customize.onclick = () => api.triggerEvent('twCustomizeNavigation',{});
host.querySelector('.tw-toolbar').insertBefore(customize,host.querySelector('.tw-import'));
host.querySelector('.tw-import').onclick = () => input.click();
input.onchange = async () => {
    if (!input.files[0]) return;
    try {
        const pkg = JSON.parse(await input.files[0].text());
        if (pkg?.format !== 'trilium-workbench-package' || !Array.isArray(pkg.notes)) throw new Error('这不是完整的 Trilium 工作包。');
        const dialog = document.createElement('dialog');
        dialog.className = 'tw-import-dialog';
        dialog.innerHTML = `<form method="dialog"><h2>安装本地工作包</h2><p class="tw-package-name"></p><p>工作包包含可运行的界面和脚本。请确认来源可信；已有工作数据不会被重导覆盖。</p><label class="tw-trust"><input type="checkbox">我信任这个工作包，允许它在本工作区运行</label><p class="tw-import-error" role="alert"></p><div class="tw-actions"><button value="cancel">取消</button><button type="button" class="tw-primary tw-confirm" disabled>确认安装并启用</button></div></form>`;
        dialog.querySelector('.tw-package-name').textContent = `${pkg.title} · ${pkg.version} · ${pkg.notes.length} 个文件`;
        dialog.querySelector('input').onchange = event => { dialog.querySelector('.tw-confirm').disabled = !event.target.checked; };
        dialog.querySelector('.tw-confirm').onclick = async event => {
            event.target.disabled = true;
            try {
                const id = await api.runOnBackend(installSource, [pkg]);
                await api.triggerEvent('twNavigationChanged',{});
                dialog.close();
                await api.activateNote(id);
            } catch (e) { dialog.querySelector('.tw-import-error').textContent = e.message; event.target.disabled = false; }
        };
        dialog.onclose = () => dialog.remove();
        host.querySelector('.tw').append(dialog); dialog.showModal();
    } catch (e) { api.showError(e.message); }
    finally { input.value = ''; }
};
host.querySelector(".tw-backup").onclick = async event => {
    const button = event.currentTarget;
    const result = host.querySelector(".tw-backup-result");
    button.disabled = true;
    result.textContent = "正在创建完整备份…";
    try {
        const file = await api.runAsyncOnBackendWithManualTransactionHandling(async () => api.backupNow("workbench-" + Date.now()));
        result.textContent = "备份已完成：" + file;
    } catch (e) { result.textContent = "备份未完成：" + e.message; }
    finally { button.disabled = false; }
};
const list = host.querySelector(".tw-catalog");
for (const pkg of entries) {
    const item = document.createElement("article");
    item.className = "tw-package";
    item.innerHTML = `<div class="tw-icon"></div><div class="tw-package-copy"><h2></h2><p></p><small></small></div><div class="tw-actions"><button class="tw-primary"></button><button class="tw-disable" hidden>停用</button></div>`;
    item.querySelector('.tw-icon').textContent = Array.from(new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(pkg.title.trim()))[0]?.segment || '工';
    item.querySelector("h2").textContent = pkg.title;
    item.querySelector("p").textContent = pkg.description;
    list.append(item);
    const open = item.querySelector(".tw-primary");
    const disable = item.querySelector(".tw-disable");
    async function refresh() {
        const state = await api.runOnBackend(id => {
            const n = api.getNote(id);
            return n ? n.getLabelValue("workbenchEnabled") === "true" ? "enabled" : "disabled" : "absent";
        }, [pkg.rootId]);
        item.querySelector("small").textContent = state === "enabled" ? `已启用 · ${pkg.version} · 本地保存` : state === "disabled" ? "已停用 · 已有资料仍保留" : `未安装 · ${pkg.version}`;
        open.textContent = state === "enabled" ? "打开工作台" : state === "disabled" ? "重新启用" : "启用工作台";
        disable.hidden = state !== "enabled";
    }
    open.onclick = async () => {
        open.disabled = true;
        try {
            const id = await api.runOnBackend(installSource, [pkg]);
            await api.triggerEvent('twNavigationChanged',{});
            await api.activateNote(id);
        } catch (e) { api.showError(e.message); }
        finally { open.disabled = false; await refresh(); }
    };
    disable.onclick = async () => {
        disable.disabled = true;
        try {
            await api.runOnBackend(id => {
                const n = api.getNote(id);
                n.setLabel("workbenchEnabled", "false");
                n.title = n.title + "（已停用）";
                n.save();
            }, [pkg.rootId]);
            await refresh();
            await api.triggerEvent('twNavigationChanged',{});
        } catch (e) { api.showError(e.message); }
        finally { disable.disabled = false; }
    };
    await refresh();
}
