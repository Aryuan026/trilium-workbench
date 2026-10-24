// A human-facing view over Trilium's native search; no separate index or data copy.
const host = api.$container[0], queryId = crypto.randomUUID();
host.innerHTML = `<main class="tw tw-find"><p class="tw-eyebrow">我的工作区 / 查找资料</p><div class="tw-heading"><div><h1>查找资料</h1><p class="tw-lead">找工作台、表格和文档，点开就能继续。</p></div><button class="tw-find-manage">工作台管理</button></div><form class="tw-find-form"><label for="${queryId}">关键词</label><div class="tw-find-input"><input id="${queryId}" type="search" placeholder="输入标题或正文关键词" autocomplete="off"><button class="tw-primary" type="submit">查找</button><button class="tw-find-clear" type="button" disabled>清空</button></div></form><nav class="tw-find-filters" aria-label="资料分类"></nav><div class="tw-find-statusbar"><p class="tw-note tw-find-status" role="status" aria-live="polite"></p><button class="tw-find-refresh">刷新资料</button></div><section class="tw-find-results" aria-label="资料结果"></section><details class="tw-find-advanced"><summary>高级工具</summary><p class="tw-note">复杂搜索条件和批量操作在原生高级搜索中；工作台代码与配置收在技术资料里。</p><div class="tw-actions"><button class="tw-find-native">原生高级搜索</button><button class="tw-find-source">技术资料</button></div></details></main>`;
const categories = [['all','全部',''],['workbench','工作台','bx-layout'],['sheet','表格','bx-spreadsheet'],['document','文档','bx-file'],['attachment','附件','bx-paperclip']];
const query = host.querySelector('input[type=search]'), status = host.querySelector('.tw-find-status');
const results = host.querySelector('.tw-find-results'), filters = host.querySelector('.tw-find-filters');
const submit = host.querySelector('[type=submit]'), clear = host.querySelector('.tw-find-clear');
const refresh = host.querySelector('.tw-find-refresh');
let selected = 'all', notes = [], limited = false;
function node(tag, className, text) {
    const element = document.createElement(tag); element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}
function draw() {
    filters.replaceChildren(); results.replaceChildren();
    for (const [key,label] of categories) {
        const count = notes.filter(note => key === 'all' || note.kind === key).length;
        const button = node('button','',`${label} ${count}`); button.type = 'button';
        button.setAttribute('aria-pressed',String(selected === key));
        button.onclick = () => { selected = key; draw(); filters.querySelector('[aria-pressed=true]').focus(); };
        filters.append(button);
    }
    const visible = notes.filter(note => selected === 'all' || note.kind === selected);
    status.textContent = `${visible.length} 条资料${limited ? ' · 仅显示前 100 条匹配，更多可用高级搜索' : ''}`;
    if (!visible.length) {
        const empty = node('div','tw-find-empty');
        empty.append(node('h2','',query.value.trim() ? '没有找到匹配的资料' : '这个分类还没有资料'),node('p','',query.value.trim() ? '试试更短的关键词，或清空后查看这个分类。' : '可以切换到全部，或从工作台管理启用需要的工作包。'));
        results.append(empty); return;
    }
    for (const [key,label,glyph] of categories.slice(1)) {
        const group = visible.filter(note => note.kind === key); if (!group.length) continue;
        const section = node('section','tw-find-group'); section.append(node('h2','',`${label} · ${group.length}`));
        for (const note of group) {
            const link = node('a','tw-find-row'); link.href = `#${note.noteId}`;
            const icon = node('span',`bx ${glyph} tw-find-icon`); icon.setAttribute('aria-hidden','true');
            const copy = node('span','tw-find-copy');
            copy.append(node('strong','',note.title),node('small','',`${note.disabled ? '已停用 · 资料保留 · ' : ''}${note.parent || '我的资料'}`));
            link.append(icon,copy,node('span','tw-find-arrow','›'));
            link.onclick = async event => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); await api.activateNote(note.noteId); };
            section.append(link);
        }
        results.append(section);
    }
}
async function search() {
    submit.disabled = true; clear.disabled = true; refresh.disabled = true; status.textContent = '正在查找…';
    try {
        const result = await api.runOnBackend(value => {
            // ponytail: bound this overview to 100 matches; native advanced search handles larger result sets.
            const matches = api.searchForNotes(value.trim() ? JSON.stringify(value.trim()) : '', {includeArchivedNotes:false,limit:100});
            return {limited:matches.length === 100, notes:matches.filter(note => !['root','twFind'].includes(note.noteId) && !note.isInHiddenSubtree()).map(note => ({
                noteId:note.noteId, title:note.title,
                kind:note.hasLabel('workbenchId') ? 'workbench' : note.type === 'spreadsheet' ? 'sheet' : ['file','image'].includes(note.type) ? 'attachment' : 'document',
                parent:note.getParentNotes().filter(parent => parent.noteId !== 'root').map(parent => parent.title).join(' · '),
                disabled:note.getLabelValue('workbenchEnabled') === 'false'
            }))};
        }, [query.value]);
        notes = result.notes; limited = result.limited; draw();
    } catch (error) { status.textContent = '这次查找没有完成，请再试一次。'; }
    finally { submit.disabled = false; refresh.disabled = false; clear.disabled = !query.value; }
}
host.querySelector('form').onsubmit = event => { event.preventDefault(); if (!submit.disabled) search(); };
query.oninput = () => { clear.disabled = submit.disabled || !query.value; };
clear.onclick = () => { query.value = ''; query.focus(); search(); };
host.querySelector('.tw-find-manage').onclick = () => api.activateNote('root');
refresh.onclick = search;
host.querySelector('.tw-find-native').onclick = () => { host.querySelector('.tw-find-advanced').open = false; return api.triggerCommand('searchNotes',{searchString:query.value}); };
host.querySelector('.tw-find-source').onclick = () => { host.querySelector('.tw-find-advanced').open = false; return api.activateNote('twResources'); };
await search();
