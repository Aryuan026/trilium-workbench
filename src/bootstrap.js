function bootstrapWorkspace(bundle) {
    const root = api.getNote('root');
    if (root.getLabelValue('workbenchFormat') !== '1' && root.getLabelValue('workbenchDemo') !== 'true' &&
        root.getChildNotes().some(n => !n.noteId.startsWith('_') && n.noteId !== 'twBootstrap')) {
        throw new Error('初始化只接受空白或本项目工作区，未修改现有内容。');
    }
    for (let spec of bundle.notes) {
        const existing = api.getNote(spec.noteId);
        if (existing) {
            // Installed registry and preparation are user state, not build output.
            if (!['twCatalogData','twNavigationData'].includes(spec.noteId)) existing.setContent(spec.content);
            if (spec.mime && existing.mime !== spec.mime) { existing.mime = spec.mime; existing.save(); }
        } else {
            if (spec.noteId === 'twNavigationData') {
                const preferences = JSON.parse(spec.content);
                preferences.shortcuts = JSON.parse(api.getNote('twCatalogData').getContent()).filter(p => api.getNote(p.rootId)).map(p => ({rootId:p.rootId,pinned:true,glyph:'',expanded:true}));
                spec = {...spec, content:JSON.stringify(preferences)};
            }
            api.createNewNote({...spec, isExpanded:false});
        }
    }
    root.title = '我的工作台'; root.type = 'render'; root.mime = 'text/html'; root.save();
    root.setLabel('workbenchFormat', '1');
    root.setRelation('renderNote', 'twCatalogUI');
    api.createOrUpdateLauncher({id:'workbenchNavigation',type:'customWidget',title:'工作台快捷导航',isVisible:true,widgetNoteId:'twNavigationWidget'});
    for (const branch of root.getChildBranches()) {
        if (branch.noteId === 'twBootstrap') { branch.notePosition = 910; branch.save(); }
    }
    return {catalog:root.noteId, packages:JSON.parse(api.getNote('twCatalogData').getContent()).map(p=>p.id)};
}
