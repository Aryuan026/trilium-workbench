// Native custom-launcher widget; workbench data stays in the existing catalog.
const backend = await (await api.getNote('twNavigationActions')).getContent();
const tools = [
    ['searchNotes','查找资料','bx-search'], ['createNoteIntoInbox','新建笔记','bx-plus'],
    ['showRecentChanges','最近更改','bx-history'], ['showDeletedNotes','回收站','bx-trash-alt'], ['showOptions','软件设置','bx-cog']
];
const glyphs = ['','📋','📁','🔬','📚','🧰','🗓'];
const first = title => Array.from(new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(title.trim()))[0]?.segment || '工';
function element(tag, className, text) {
    const e = document.createElement(tag); e.className = className || '';
    if (text !== undefined) e.textContent = text;
    return e;
}
function button(text, className, action) {
    const e = element('button',className,text); e.type = 'button';
    e.onclick = () => Promise.resolve().then(action).catch(error => api.showError(error.message));
    return e;
}
function icon(glyph) {
    const e = glyph.startsWith('bx-') ? element('span',`tw-nav-glyph bx ${glyph}`) : element('span','tw-nav-glyph',glyph);
    e.setAttribute('aria-hidden','true'); return e;
}
class WorkbenchNavigation extends api.NoteContextAwareWidget {
    doRender() {
        this.contentSized().filling();
        document.body.classList.add('tw-shell');
        this.$widget = $(element('nav','tw-nav-rail'));
        this.$widget.attr('aria-label','工作台快捷栏');
        document.querySelector('.tw-nav-side')?.remove();
        this.side = element('nav','tw-nav-side'); this.side.setAttribute('aria-label','常用工作台');
        document.querySelector('#left-pane > .quick-search').after(this.side);
        document.querySelector('.tw-tree-toggle')?.remove();
        this.treeToggle = button('全部资料','tw-tree-toggle',async () => {
            const next = structuredClone(this.state.preferences); next.showTree = !next.showTree;
            await this.save(next);
        });
        document.querySelector('#left-pane .tree-wrapper').append(this.treeToggle);
        this.refresh().catch(e => api.showError(e.message));
    }
    isEnabled() { return true; }
    async refreshWithNote() {
        this.state = await api.runOnBackend(backend, ['read']);
        this.paint();
    }
    async twNavigationChangedEvent() { await this.refresh(); }
    twCustomizeNavigationEvent() { this.customize(); }
    async save(preferences) {
        this.state = await api.runOnBackend(backend,['save',preferences]); this.paint();
    }
    async open(rootId) {
        await api.triggerCommand('showLeftPane',{});
        await api.activateNote(rootId);
    }
    runTool(command) { return command === 'searchNotes' ? api.activateNote('twFind') : api.triggerCommand(command,{}); }
    paint() {
        const {preferences,entries} = this.state;
        document.body.classList.toggle('tw-show-tree',preferences.showTree);
        document.body.classList.toggle('tw-show-native',preferences.showNative);
        this.$widget[0].closest('#launcher-container > div')?.classList.add('tw-launcher-host');
        const rail = this.$widget[0]; rail.replaceChildren(); this.side.replaceChildren();
        const active = this.noteId;
        const railButton = (glyph,label,action,selected=false) => {
            const b = button('','tw-rail-button',action); b.title = label; b.setAttribute('aria-label',label);
            b.append(icon(glyph));
            if (selected) b.setAttribute('aria-current','page');
            rail.append(b); return b;
        };
        railButton('bx-home-alt-2','我的工作台',()=>this.open('root'),active === 'root');
        const home = button('⌂  我的工作台','tw-side-home',()=>this.open('root')); this.side.append(home);
        if (active === 'root') home.setAttribute('aria-current','page');
        const heading = element('div','tw-nav-heading'); heading.append(element('span','','常用工作台'));
        const add = button('＋','tw-nav-add',()=>this.customize()); add.setAttribute('aria-label','添加工作台快捷入口'); add.title='添加或整理快捷入口'; heading.append(add); this.side.append(heading);
        for (const shortcut of preferences.shortcuts.filter(s => s.pinned)) {
            const entry = entries.find(e => e.rootId === shortcut.rootId); if (!entry?.installed) continue;
            const selected = entry.rootId === active || entry.children.some(c => c.noteId === active);
            const glyph = shortcut.glyph || first(entry.title);
            railButton(glyph,entry.title,()=>this.open(entry.rootId),selected);
            const group = element('div','tw-nav-group'); group.dataset.rootId=entry.rootId;
            const row = element('div','tw-nav-row');
            const expand = button('','tw-nav-expand',async () => {
                const next = structuredClone(preferences); next.shortcuts.find(s=>s.rootId===entry.rootId).expanded = !shortcut.expanded; await this.save(next);
            });
            expand.append(icon(shortcut.expanded ? 'bx-chevron-down' : 'bx-chevron-right'));
            expand.setAttribute('aria-label',`${shortcut.expanded?'收起':'展开'}${entry.title}`); expand.setAttribute('aria-expanded',String(shortcut.expanded));
            const open = button('','tw-nav-open',()=>this.open(entry.rootId)); open.title=entry.title;
            open.append(element('span','tw-nav-mark',glyph),element('span','tw-nav-name',entry.title));
            if (!entry.enabled) open.append(element('small','tw-nav-disabled','已停用'));
            if (selected) row.setAttribute('data-active','true');
            row.append(expand,open); group.append(row);
            if (shortcut.expanded) {
                const children = element('div','tw-nav-children');
                for (const child of entry.children) {
                    const link = button(child.title,'tw-nav-child',()=>this.open(child.noteId)); link.title=child.title;
                    if (child.noteId === active) link.setAttribute('aria-current','page'); children.append(link);
                }
                group.append(children);
            }
            this.side.append(group);
        }
        if (!preferences.shortcuts.some(s=>s.pinned)) this.side.append(element('p','tw-nav-empty','点 ＋ 添加常用工作台'));
        railButton('bx-plus','添加入口',()=>this.customize());
        const divider = element('div','tw-rail-divider'); rail.append(divider);
        for (const [command,label,glyph] of tools.filter(t=>preferences.tools.includes(t[0]))) railButton(glyph,label,()=>this.runTool(command),command === 'searchNotes' && active === 'twFind');
        rail.append(element('div','tw-rail-space'));
        railButton('bx-dots-horizontal-rounded','更多工具',()=>this.more());
        this.side.append(button('自定义侧栏','tw-nav-customize',()=>this.customize()));
        this.treeToggle.textContent = `${preferences.showTree?'⌄':'›'}  全部资料`;
        this.treeToggle.setAttribute('aria-expanded',String(preferences.showTree));
    }
    dialog(title) {
        const dialog = element('dialog','tw tw-nav-dialog');
        const header = element('div','tw-dialog-heading'); header.append(element('h2','',title));
        const close = button('×','tw-dialog-close',()=>dialog.close()); close.setAttribute('aria-label','关闭'); header.append(close);
        dialog.append(header); document.body.append(dialog); dialog.onclose=()=>dialog.remove(); return dialog;
    }
    customize() {
        if (!this.state || document.querySelector('.tw-nav-dialog[open]')) return;
        const draft = structuredClone(this.state.preferences);
        const dialog = this.dialog('自定义侧栏');
        dialog.append(element('p','tw-lead','把常用工作台放在手边。取消固定只移除入口，资料仍保留。'));
        dialog.append(element('h3','','快捷工作台'));
        dialog.append(element('p','tw-note','勾选显示；图标选“首字”时，自动取名称的第一个字。'));
        const list = element('div','tw-shortcut-list'); dialog.append(list);
        const draw = () => {
            list.replaceChildren();
            const installed = this.state.entries.filter(e=>e.installed);
            const ordered = [...draft.shortcuts.map(s=>installed.find(e=>e.rootId===s.rootId)).filter(Boolean),...installed.filter(e=>!draft.shortcuts.some(s=>s.rootId===e.rootId))];
            for (const entry of ordered) {
                let item = draft.shortcuts.find(s=>s.rootId===entry.rootId);
                if (!item) { item={rootId:entry.rootId,pinned:false,glyph:'',expanded:true}; draft.shortcuts.push(item); }
                const row = element('div','tw-shortcut-setting'); row.dataset.rootId=entry.rootId;
                const label = element('label','tw-shortcut-check'); const check=element('input'); check.type='checkbox';check.checked=item.pinned;
                check.onchange=()=>{item.pinned=check.checked;};
                const preview=element('span','tw-nav-mark',item.glyph||first(entry.title));
                label.append(check,preview,element('span','tw-nav-name',entry.title)); row.append(label);
                const controls=element('div','tw-shortcut-controls');
                const select=element('select');select.setAttribute('aria-label',`${entry.title}的快捷图标`);
                for (const glyph of glyphs) { const option=element('option','',glyph||`首字 · ${first(entry.title)}`);option.value=glyph;select.append(option); }
                select.value=item.glyph;select.onchange=()=>{item.glyph=select.value;preview.textContent=item.glyph||first(entry.title);};controls.append(select);
                const index=draft.shortcuts.indexOf(item);
                for (const [delta,text] of [[-1,'↑'],[1,'↓']]) {
                    const move=button(text,'tw-shortcut-move',()=>{const to=index+delta;[draft.shortcuts[index],draft.shortcuts[to]]=[draft.shortcuts[to],draft.shortcuts[index]];draw();dialog.querySelector(`[data-root-id="${entry.rootId}"] .tw-shortcut-move`)?.focus();});
                    move.setAttribute('aria-label',`${delta<0?'上移':'下移'}${entry.title}`);move.disabled=index+delta<0||index+delta>=draft.shortcuts.length;controls.append(move);
                }
                row.append(controls);list.append(row);
            }
            if (!ordered.length) list.append(element('p','tw-note','还没有已安装的工作台。先从我的工作台启用一个。'));
        }; draw();
        dialog.append(element('h3','','常用工具'));
        const choices=element('div','tw-tool-choices');
        for (const [command,label] of tools) {
            const l=element('label');const input=element('input');input.type='checkbox';input.checked=draft.tools.includes(command);
            input.onchange=()=>{draft.tools=input.checked?[...draft.tools,command]:draft.tools.filter(t=>t!==command);};l.append(input,document.createTextNode(label));choices.append(l);
        }
        dialog.append(choices);
        const native=element('label','tw-native-choice');const nativeInput=element('input');nativeInput.type='checkbox';nativeInput.checked=draft.showNative;nativeInput.onchange=()=>{draft.showNative=nativeInput.checked;};native.append(nativeInput,document.createTextNode('同时显示 Trilium 原生工具栏'));dialog.append(native);
        const feedback=element('p','tw-note');feedback.setAttribute('role','status');dialog.append(feedback);
        const actions=element('div','tw-actions');actions.append(button('取消','',()=>dialog.close()));
        const save=button('保存侧栏','tw-primary',async()=>{save.disabled=true;try{await this.save(draft);dialog.close();api.showMessage('侧栏已保存；未固定的工作台和资料仍保留。');}catch(e){feedback.textContent=e.message;}finally{save.disabled=false;}});actions.append(save);dialog.append(actions);dialog.showModal();
    }
    more() {
        if (document.querySelector('.tw-nav-dialog[open]')) return;
        const dialog=this.dialog('更多工具');
        const list=element('div','tw-more-tools');
        for (const [command,label,glyph] of tools) {
            const item=button('','',async()=>{dialog.close();await this.runTool(command);});item.append(icon(glyph),document.createTextNode(label));list.append(item);
        }
        list.append(button('⚙  自定义侧栏','',()=>{dialog.close();this.customize();}));dialog.append(list);
        dialog.append(element('p','tw-note',`回收站可恢复已删除笔记；当前自动清除时间为 ${this.state.retentionDays} 天。`));dialog.showModal();
    }
}
return new WorkbenchNavigation();
