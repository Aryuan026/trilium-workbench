function installWorkbench(pkg) {
    if (pkg?.format !== 'trilium-workbench-package' || pkg.schemaVersion !== 1 || !/^[a-z][a-z0-9-]*$/.test(pkg.id) ||
        typeof pkg.title !== 'string' || !pkg.title.trim() || typeof pkg.version !== 'string' || !pkg.version || !Array.isArray(pkg.notes)) {
        throw new Error('请选择格式为 v1 的完整 Trilium 工作包。');
    }
    const known = new Set();
    for (const spec of pkg.notes) {
        if (!/^[A-Za-z0-9][A-Za-z0-9_]{3,127}$/.test(spec.noteId) || spec.noteId === 'root' || known.has(spec.noteId) ||
            typeof spec.title !== 'string' || typeof spec.type !== 'string' || typeof spec.content !== 'string' ||
            (known.size === 0 ? spec.noteId !== pkg.rootId || spec.parentNoteId !== 'root' : !known.has(spec.parentNoteId))) {
            throw new Error('工作包的笔记编号或目录结构不完整，未安装。');
        }
        known.add(spec.noteId);
    }
    if (!known.has(pkg.rendererId) || (pkg.dataId && !known.has(pkg.dataId)) || (pkg.preparationId && !known.has(pkg.preparationId))) {
        throw new Error('工作包缺少界面或数据文件，未安装。');
    }
    const catalog = api.getNote('twCatalogData');
    function addShortcut() {
        const note = api.getNote('twNavigationData'), preferences = JSON.parse(note.getContent());
        if (!preferences.shortcuts.some(s => s.rootId === pkg.rootId)) {
            preferences.shortcuts.push({rootId:pkg.rootId,pinned:true,glyph:'',expanded:true});
            note.setContent(JSON.stringify(preferences));
        }
    }
    function archiveInternalNotes() {
        for (const spec of pkg.notes.filter(note => (note.type === 'code' && note.noteId !== pkg.dataId) || note.attributes?.some(a => a.type === 'label' && a.name === 'workbenchInternal' && a.value === 'true'))) {
            const note = api.getNote(spec.noteId); if (!note) continue;
            const archived = note.getLabel('archived') || note.addLabel('archived');
            archived.isInheritable = true; archived.save();
        }
    }
    const entries = JSON.parse(catalog.getContent());
    const registered = entries.find(p => p.id === pkg.id);
    if (registered && (registered.rootId !== pkg.rootId || registered.version !== pkg.version)) {
        throw new Error('目录中已有这个工作包的其他版本；本次没有覆盖工作数据。');
    }
    const existing = api.getNote(pkg.rootId);
    if (existing) {
        if (existing.getLabelValue("workbenchId") !== pkg.id) throw new Error("工作包编号冲突，未覆盖原数据。");
        if (existing.getLabelValue('workbenchVersion') !== pkg.version) throw new Error('已安装版本不同，未覆盖已有数据。');
        existing.setLabel("workbenchEnabled", "true");
        existing.title = pkg.title;
        existing.save();
        if (!registered) { entries.push(pkg); catalog.setContent(JSON.stringify(entries)); }
        addShortcut();
        archiveInternalNotes();
        return existing.noteId;
    }
    for (const spec of pkg.notes) {
        if (api.getNote(spec.noteId)) throw new Error("工作包笔记编号冲突，未覆盖原数据。");
    }
    for (const spec of pkg.notes) {
        api.createNewNote({ ...spec, content:spec.contentFormat === 'markdown' ? api.markdownToHtml(spec.content) : spec.content, parentNoteId: spec.parentNoteId || "root", isExpanded: false });
    }
    const home = api.getNote(pkg.rootId);
    home.setLabel("workbenchId", pkg.id);
    home.setLabel("workbenchEnabled", "true");
    home.setLabel("workbenchVersion", pkg.version);
    home.setRelation("renderNote", pkg.rendererId);
    if (pkg.dataId) home.setRelation("workbenchData", pkg.dataId);
    if (pkg.preparationId) home.setRelation('workbenchPreparation', pkg.preparationId);
    if (!registered) { entries.push(pkg); catalog.setContent(JSON.stringify(entries)); }
    addShortcut();
    archiveInternalNotes();
    return home.noteId;
}
