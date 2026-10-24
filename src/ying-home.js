const home = api.originEntity;
const host = api.$container[0];
const state = await api.runOnBackend(id => {
    const note = api.getNote(id);
    return { enabled: note.getLabelValue("workbenchEnabled") === "true", dataId: note.getRelationValue("workbenchData"), preparationId:note.getRelationValue('workbenchPreparation') };
}, [home.noteId]);
host.innerHTML = `<main class="tw"><p class="tw-eyebrow">我的工作台 / 荧小助</p><div class="tw-heading"><div><h1>学生管理</h1><p class="tw-lead">先把资料看清楚，再处理下一步。</p></div><button class="tw-directory">工作台目录</button></div><div class="tw-banner">合成资料演示 · 本地保存 · 真实服务器未连接</div><div class="tw-content"></div></main>`;
host.querySelector(".tw-directory").onclick = async () => { await api.activateNote("root"); api.triggerEvent("renderActiveNote", {}); };
const content = host.querySelector(".tw-content");
if (!state.enabled) {
    content.innerHTML = `<h2>这个工作台已停用</h2><p>已有表格和资料仍保留。回到工作台目录即可重新启用。</p>`;
} else {
    const preparation = state.preparationId ? JSON.parse(await (await api.getNote(state.preparationId)).getContent()) : {materialsReady:false,aiGuidePrepared:false};
    const snapshot = JSON.parse(await (await api.getNote(state.dataId)).getContent());
    const sheet = snapshot.workbook.sheets[snapshot.workbook.sheetOrder[0]];
    const values = Object.entries(sheet.cellData).sort((a, b) => Number(a[0]) - Number(b[0])).map(([, cells]) => [0,1,2,3,4,5].map(i => String(cells[i]?.v ?? "")));
    const rows = values.slice(1).filter(row => row.some(Boolean));
    content.innerHTML = `<section class="tw-summary"><strong>${rows.length}<span>条合成人员记录</span></strong><p>与学生总表共用数据，编辑后刷新即可。</p></section><div class="tw-toolbar"><label>查找学生<input type="search" placeholder="姓名、课题组或设备" /></label><div class="tw-actions"><button class="tw-refresh">刷新表格</button><button class="tw-primary tw-sheet">打开完整表格</button></div></div><div class="tw-table-scroll"><table><thead></thead><tbody></tbody></table></div><p class="tw-note" aria-live="polite"></p><section class="tw-preparation"><h2>资料与辅助 AI</h2><p>辅助 AI：尚未连接。把工作包指引交给 WorkBuddy 等外部工具即可准备，常规办公不依赖 AI。</p><label><input type="checkbox" data-key="materialsReady">合成资料已准备好</label><label><input type="checkbox" data-key="aiGuidePrepared">已把指引交给外部辅助 AI（只记录准备进度）</label><p class="tw-preparation-result" aria-live="polite"></p></section><section class="tw-links"><a href="#root/${home.noteId}/twYingGuide">资料准备与 AI 指引 →</a><a href="#root/${home.noteId}/twYingRecovery">备份与恢复 →</a></section>`;
    content.querySelector('.tw-refresh').onclick = () => api.triggerEvent('renderActiveNote', {});
    content.querySelector('.tw-sheet').onclick = () => api.activateNote(state.dataId);
    for (const checkbox of content.querySelectorAll('.tw-preparation input')) {
        checkbox.checked = preparation[checkbox.dataset.key] === true;
        checkbox.disabled = !state.preparationId;
        checkbox.onchange = async () => {
            checkbox.disabled = true;
            try {
                await api.runOnBackend((id,key,value) => {
                    if (!['materialsReady','aiGuidePrepared'].includes(key) || typeof value !== 'boolean') throw new Error('准备状态无效');
                    const note=api.getNote(id), data=JSON.parse(note.getContent());
                    data[key]=value; note.setContent(JSON.stringify(data));
                }, [state.preparationId,checkbox.dataset.key,checkbox.checked]);
                content.querySelector('.tw-preparation-result').textContent='准备进度已保存在工作区；这不代表 AI 已连接。';
            } catch(e) { checkbox.checked=!checkbox.checked; api.showError(e.message); }
            finally { checkbox.disabled=false; }
        };
    }
    const header = document.createElement("tr");
    for (const name of values[0]) { const th = document.createElement("th"); th.textContent = name; header.append(th); }
    content.querySelector("thead").append(header);
    const search = content.querySelector("input");
    function renderRows() {
        const selected = rows.filter(row => row.join(" ").toLowerCase().includes(search.value.trim().toLowerCase()));
        const body = content.querySelector("tbody"); body.replaceChildren();
        for (const row of selected) {
            const tr = document.createElement("tr");
            for (const value of row) { const td = document.createElement("td"); td.textContent = value; tr.append(td); }
            body.append(tr);
        }
        content.querySelector(".tw-note").textContent = selected.length ? `显示 ${selected.length} 条 · 需要编辑时打开完整表格` : "没有匹配记录，清空搜索即可查看全部。";
    }
    search.oninput = renderRows;
    renderRows();
}
