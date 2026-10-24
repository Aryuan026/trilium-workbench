const host = api.$container[0], noteId = api.originEntity.noteId;
const backend = await (await api.getNote('twExternalActions')).getContent();
host.innerHTML = '<section class="tw-external"><div class="tw-external-controls"><button>保存并退出工作区</button></div><div class="tw-external-body"><p class="tw-note" role="status">正在打开本地工作台…</p></div></section>';
const container = host.querySelector('.tw-external-body'), status = container.firstElementChild;
host.querySelector('button').onclick = async event => {
    event.currentTarget.disabled = true;
    try { await api.runAsyncOnBackendWithManualTransactionHandling(backend,[noteId,{closeWorkspace:true}]); }
    catch(error) { api.showError(error.message); event.currentTarget.disabled = false; }
};
try {
    const html = await api.runAsyncOnBackendWithManualTransactionHandling(backend, [noteId,{document:true}]);
    const frame = document.createElement('iframe'), channel = crypto.randomUUID();
    frame.className = 'tw-external-frame'; frame.title = '本地工作台';
    frame.setAttribute('sandbox','allow-scripts allow-forms allow-downloads');
    const script = `<script>
      (()=>{
        const channel=${JSON.stringify(channel)}, pending=new Map();let serial=0;
        window.trainingWorkbenchHost={request:(path,body)=>new Promise((resolve,reject)=>{
          const id=++serial;pending.set(id,{resolve,reject});
          parent.postMessage({channel,id,path,method:body===undefined?'GET':'POST',body},'*');
        })};
        addEventListener('message',event=>{
          if(event.source!==parent||event.data?.channel!==channel)return;
          const task=pending.get(event.data.id);if(!task)return;pending.delete(event.data.id);
          event.data.ok?task.resolve(event.data.value):task.reject(new Error(event.data.error));
        });
      })();
    <\/script>`;
    const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; connect-src \'none\'; base-uri \'none\'; form-action \'none\'">';
    const parsed = new DOMParser().parseFromString(html,'text/html');
    parsed.head.insertAdjacentHTML('afterbegin',csp+script);
    frame.srcdoc = '<!doctype html>' + parsed.documentElement.outerHTML;
    const receive = async event => {
        if (event.source !== frame.contentWindow || event.data?.channel !== channel) return;
        const {id,path,method,body} = event.data;
        if (!Number.isSafeInteger(id) || id < 1) return;
        let result;
        try {
            const value = await api.runAsyncOnBackendWithManualTransactionHandling(backend,[noteId,{path,method,...(method==='POST'?{body}:{})}]);
            result = {channel,id,ok:true,value};
        } catch(error) { result = {channel,id,ok:false,error:error.message}; }
        frame.contentWindow?.postMessage(result,'*');
    };
    window.addEventListener('message',receive);
    const observer = new MutationObserver(()=>{
        if (!frame.isConnected) { window.removeEventListener('message',receive); observer.disconnect(); }
    });
    container.replaceChildren(frame); observer.observe(document.body,{childList:true,subtree:true});
} catch(error) { status.textContent = error.message; }
