async function externalRequest(noteId, request) {
    const note = api.getNote(noteId);
    if (!note) throw new Error('这个工作台页面已不存在。');
    const id = note.getLabelValue('workbenchExternal');
    // Only the launcher supplies these machine-local bindings; no credentials live in notes.
    const binding = JSON.parse(process.env.TRILIUM_WORKBENCH_BINDINGS || '{}')[id];
    if (!binding) throw new Error('本机工作包尚未启动，请通过工作台启动器重新打开。');
    if (note.noteId !== binding.rootId && !note.hasAncestor(binding.rootId)) throw new Error('这个页面不属于已连接的工作台。');
    if (request.closeWorkspace === true) {
        process.kill(binding.launcherPid,'SIGUSR1'); return {closing:true};
    }
    if (api.getNote(binding.rootId)?.getLabelValue('workbenchEnabled') !== 'true') {
        throw new Error('这个工作台已停用，已有资料仍保留。');
    }
    const origin = new URL(binding.origin);
    if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.origin !== binding.origin || !origin.port) {
        throw new Error('工作包入口必须是受管的本机服务。');
    }
    let target = '/', method = 'GET';
    if (!request.document) {
        if (!/^[a-z][a-z-]*$/.test(request.path) || !['GET','POST'].includes(request.method) || binding.routes[request.path] !== request.method) {
            throw new Error('这个工作台操作不在已安装工作包的范围内。');
        }
        target = '/api/' + request.path; method = request.method;
    }
    const body = method === 'POST' ? JSON.stringify(request.body) : undefined;
    if (body && new TextEncoder().encode(body).length > binding.maxRequestBytes) throw new Error('本次资料超过工作包的请求上限，请缩小文件。');
    let response;
    try {
        response = await fetch(binding.origin + target, {method,redirect:'error',headers:{'X-Workbench-Token':binding.token,'Content-Type':'application/json'},body,signal:AbortSignal.timeout(300000)});
    } catch {
        throw new Error('本地工作台连接中断，资料仍保留。若刚提交过操作，请重新打开并核对原结果。');
    }
    if (request.document) {
        if (!response.ok) throw new Error('工作台页面尚未就绪，请重新打开。');
        return response.text();
    }
    let result;
    try { result = await response.json(); }
    catch { throw new Error('工作包没有返回有效结果，请刷新核对，未确认的操作不算完成。'); }
    if (!response.ok) throw new Error(result.error || '操作没有完成，请刷新核对。');
    return result;
}
