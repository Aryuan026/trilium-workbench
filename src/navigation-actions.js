function navigation(action = 'read', preferences) {
    const catalog = JSON.parse(api.getNote('twCatalogData').getContent());
    const entries = catalog.map(pkg => {
        const note = api.getNote(pkg.rootId);
        return { rootId:pkg.rootId, title:pkg.title, installed:!!note, enabled:note?.getLabelValue('workbenchEnabled') === 'true',
            children:note ? note.getChildNotes().filter(n => n.type !== 'code' && n.getLabelValue('workbenchInternal') !== 'true').map(n => ({noteId:n.noteId,title:n.title})) : [] };
    });
    const config = api.getNote('twNavigationData');
    if (action === 'save') {
        const installed = new Set(entries.filter(e => e.installed).map(e => e.rootId));
        const tools = ['searchNotes','createNoteIntoInbox','showRecentChanges','showDeletedNotes','showOptions'];
        const glyphs = ['','📋','📁','🔬','📚','🧰','🗓'];
        if (!preferences || !Array.isArray(preferences.shortcuts) || !Array.isArray(preferences.tools) ||
            typeof preferences.showTree !== 'boolean' || typeof preferences.showNative !== 'boolean' ||
            new Set(preferences.shortcuts.map(s => s.rootId)).size !== preferences.shortcuts.length ||
            preferences.shortcuts.some(s => !installed.has(s.rootId) || !glyphs.includes(s.glyph) || typeof s.pinned !== 'boolean' || typeof s.expanded !== 'boolean') ||
            new Set(preferences.tools).size !== preferences.tools.length || preferences.tools.some(t => !tools.includes(t))) {
            throw new Error('侧栏设置无效，原来的设置已保留。');
        }
        config.setContent(JSON.stringify(preferences));
    } else if (action !== 'read') throw new Error('不支持这个侧栏操作。');
    return { entries, preferences:JSON.parse(config.getContent()), retentionDays:Number(api.sql.getValue("SELECT value FROM options WHERE name='eraseEntitiesAfterTimeInSeconds'")) / 86400 };
}
