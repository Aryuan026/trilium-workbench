const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'..'), launcher=path.join(root,'outputs/Trilium 工作台.app/Contents/MacOS/Workbench');
const trilium=process.env.TRILIUM_APP || path.join(require('node:os').homedir(),'Applications/Trilium Notes.app');
const run=path.join(root,'work/recovery-check-'+Date.now()), marker='示例学生一（新工作区恢复验收）';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const children=new Set(), sessions=[];
async function start(folder,machine,restore,open=false) {
  const args=[open?'--open':'--new',folder,'--runtime-root',machine,'--trilium',trilium,'--testing'];
  if(restore)args.push('--restore',restore);
  const child=cp.spawn(launcher,args);children.add(child);
  let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
  const exit=new Promise(resolve=>child.on('exit',code=>{children.delete(child);resolve(code)}));
  for(let i=0;i<900;i++) {
    if(child.exitCode!==null)throw new Error(output);
    const workspaceFile=path.join(folder,'workspace.json');
    if(fs.existsSync(workspaceFile)) {
      const workspace=JSON.parse(fs.readFileSync(workspaceFile));
      const infoFile=path.join(machine,workspace.id,'testing.json');
      if(fs.existsSync(infoFile) && output.includes('READY ')) {
        const info=JSON.parse(fs.readFileSync(infoFile));
        const browser=await chromium.connectOverCDP('http://127.0.0.1:'+info.debugPort);
        const page=browser.contexts()[0].pages().find(p=>p.url().startsWith('trilium-app://app/'));
        await page.waitForFunction(()=>Array.from(document.querySelectorAll('.tw h1')).some(e=>e.getBoundingClientRect().width));
        if(await page.getByRole('button',{name:'工作台目录',exact:true}).isVisible())await page.getByRole('button',{name:'工作台目录',exact:true}).click();
        await page.getByRole('heading',{name:'把需要的工作，放在手边。'}).waitFor();
        assert.equal(await backend(page,'()=>api.getAppInfo().appVersion'),'0.106.1');
        const session={folder,machine,info,child,exit,browser,page,output:()=>output}; sessions.push(session);return session;
      }
    }
    await pause(100);
  }
  throw new Error('Launcher readiness timeout: '+output);
}
async function backend(page,script) {
  return page.evaluate(async script=>{
    const r=await fetch('api/script/exec',{method:'POST',headers:{...glob.getHeaders(),'Content-Type':'application/json'},body:JSON.stringify({script,params:[],startNoteId:'twBootstrap',currentNoteId:'twBootstrap',originEntityName:'notes',originEntityId:'root',transactional:true})});
    const result=await r.json();if(!r.ok||!result.success)throw new Error(result.error||'backend failed');return result.executionResult;
  },script);
}
const state=p=>backend(p,'()=>({value:JSON.parse(api.getNote("twYingSheet").getContent()).workbook.sheets.students.cellData[1][0].v,enabled:api.getNote("twYing").getLabelValue("workbenchEnabled"),preparation:JSON.parse(api.getNote("twYingPreparation").getContent())})');
async function stop(session,expected=0) {
  await session.browser.close();
  process.kill(Number(session.info.pid),'SIGTERM');
  assert.equal(await session.exit,expected,session.output());
  if(expected===0)assert(session.output().includes('SAVED '),session.output());
}
function backup(folder) {const m=JSON.parse(fs.readFileSync(path.join(folder,'workspace.json')));return path.join(folder,m.latestBackup)}
function reject(args,pattern) {
  const r=cp.spawnSync(launcher,args,{encoding:'utf8',timeout:10000});
  assert.equal(r.status,1,r.stderr);assert.match(r.stderr,pattern);
}
async function checkMovedNormalLaunch() {
  const moved=path.join(run,'moved/Trilium 工作台.app');
  fs.cpSync(path.join(root,'outputs/Trilium 工作台.app'),moved,{recursive:true});
  const folder=path.join(run,'normal'),machine=path.join(run,'normal-machine');
  // The last successful choice must also work after moving the launcher, without --trilium.
  const child=cp.spawn(path.join(moved,'Contents/MacOS/Workbench'),['--new',folder,'--runtime-root',machine]);
  children.add(child);let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
  const exit=new Promise(resolve=>child.on('exit',code=>{children.delete(child);resolve(code)}));
  for(let i=0;i<900;i++) {
    if(child.exitCode!==null)throw new Error(output);
    const processes=cp.execFileSync('/bin/ps',['-axo','pid,ppid,command'],{encoding:'utf8'});
    const match=processes.match(new RegExp('^\\s*(\\d+)\\s+'+child.pid+'\\s+(.+trilium --user-data-dir=.+)$','m'));
    if(match && !match[2].includes('--remote-debugging')) {
      const workspace=JSON.parse(fs.readFileSync(path.join(folder,'workspace.json'))),runtime=path.join(machine,workspace.id);
      if(!fs.readFileSync(path.join(runtime,'launcher.log'),'utf8').includes('200 GET /api/tree')){await pause(100);continue;}
      const port=fs.readFileSync(path.join(runtime,'electron/DevToolsActivePort'),'utf8').split('\n')[0];
      await assert.rejects(fetch('http://127.0.0.1:'+port+'/json/list'));
      process.kill(Number(match[1]),'SIGTERM');
      assert.equal(await exit,0,output);assert(output.includes('SAVED '));assert(fs.existsSync(backup(folder)));
      return {moved,rememberedTrilium:true,normalDebugPortClosed:true,backup:backup(folder)};
    }
    await pause(100);
  }
  throw new Error('Normal launch timeout: '+output);
}
(async()=>{
  fs.mkdirSync(run,{recursive:true});
  const a=await start(path.join(run,'A'),path.join(run,'machine-A'));
  const page=a.page;
  reject(['--open',a.folder,'--runtime-root',a.machine],/已在运行/);
  assert.equal(await backend(page,'()=>!!api.getNote("twYing")'),false);
  await page.getByRole('button',{name:'安装本地工作包',exact:true}).click();
  await page.locator('.tw:visible .tw-file').setInputFiles(path.join(root,'outputs/packages/ying-students.json'));
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  assert(await dialog.getByRole('button',{name:'确认安装并启用'}).isDisabled());
  await page.setViewportSize({width:1440,height:900});
  await page.screenshot({path:path.join(root,'outputs/本地工作包确认.png')});
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button',{name:'确认安装并启用'}).click();
  await page.getByRole('heading',{name:'学生管理',exact:true}).waitFor();
  await page.locator('[data-key="materialsReady"]').check();
  await page.locator('[data-key="aiGuidePrepared"]').check();
  await page.locator('.tw-preparation-result').filter({hasText:'不代表 AI 已连接'}).waitFor();
  const search=page.getByPlaceholder('姓名、课题组或设备');
  await search.fill('示例乙组');assert.equal(await page.locator('.tw:visible tbody tr').count(),1);await search.fill('');
  await page.getByRole('button',{name:'打开完整表格',exact:true}).click();
  const nameBox=page.locator('.spreadsheet input[class*="univer-appearance-none"]');await nameBox.waitFor();
  await nameBox.fill('A2');await nameBox.press('Enter');await page.keyboard.press('F2');
  await page.keyboard.press('ControlOrMeta+A');await page.keyboard.insertText(marker);await page.keyboard.press('Enter');
  for(let i=0;i<40;i++){if((await state(page)).value===marker)break;await pause(250)}
  assert.equal((await state(page)).value,marker);
  await page.getByRole('link',{name:'荧小助 · 学生管理',exact:true}).click();
  await page.getByRole('heading',{name:'学生管理',exact:true}).waitFor();
  await page.getByRole('button',{name:'刷新表格',exact:true}).click();
  await page.waitForFunction(marker=>Array.from(document.querySelectorAll('.tw tbody')).some(e=>e.getBoundingClientRect().width&&e.innerText.includes(marker)),marker,{timeout:7000});
  const overflow=[];
  for(const width of [1440,1024,390]) {
    await page.setViewportSize({width,height:900});
    const result=await page.evaluate(()=>({document:document.documentElement.scrollWidth-document.documentElement.clientWidth,workbench:Array.from(document.querySelectorAll('.tw')).filter(e=>e.getBoundingClientRect().width).map(e=>e.scrollWidth-e.clientWidth).reduce((a,b)=>Math.max(a,b),0)}));
    assert.equal(result.document,0);assert.equal(result.workbench,0);overflow.push({width,...result});
  }
  await page.setViewportSize({width:1440,height:900});
  await page.screenshot({path:path.join(root,'outputs/准备状态与未连接.png')});
  await page.getByRole('button',{name:'工作台目录',exact:true}).click();
  await page.getByRole('button',{name:'停用',exact:true}).click();
  await page.getByRole('button',{name:'重新启用',exact:true}).waitFor();
  assert.equal((await state(page)).enabled,'false');
  await page.getByRole('button',{name:'重新启用',exact:true}).click();
  await page.getByRole('heading',{name:'学生管理',exact:true}).waitFor();
  await page.getByRole('button',{name:'工作台目录',exact:true}).click();
  // Reimport the same trusted package: edits and preparation must survive.
  await page.locator('.tw:visible .tw-file').setInputFiles(path.join(root,'outputs/packages/ying-students.json'));
  await page.getByRole('dialog').getByRole('checkbox').check();
  await page.getByRole('dialog').getByRole('button',{name:'确认安装并启用'}).click();
  await page.getByRole('heading',{name:'学生管理',exact:true}).waitFor();
  const expected={value:marker,enabled:'true',preparation:{materialsReady:true,aiGuidePrepared:true}};
  assert.deepEqual(await state(page),expected);
  await page.getByRole('button',{name:'工作台目录',exact:true}).click();
  await page.getByRole('button',{name:'创建完整备份',exact:true}).click();
  await page.locator('.tw:visible .tw-backup-result').filter({hasText:'备份已完成：'}).waitFor();
  const nativeBackup=(await page.locator('.tw:visible .tw-backup-result').innerText()).replace('备份已完成：','');
  assert(fs.existsSync(nativeBackup));
  await stop(a);
  const aBackup=backup(a.folder);assert(fs.existsSync(aBackup));
  const bFolder=path.join(run,'B'),bMachine=path.join(run,'machine-B');
  assert(!fs.existsSync(bFolder));assert(!fs.existsSync(bMachine));
  const b=await start(bFolder,bMachine,aBackup);
  assert.notEqual(b.info.runtime,a.info.runtime);
  assert.notEqual(JSON.parse(fs.readFileSync(path.join(bFolder,'workspace.json'))).id,JSON.parse(fs.readFileSync(path.join(a.folder,'workspace.json'))).id);
  assert.deepEqual(await state(b.page),expected);
  await b.page.getByRole('button',{name:'打开工作台',exact:true}).click();
  await b.page.getByRole('heading',{name:'学生管理',exact:true}).waitFor();
  assert((await b.page.locator('.tw:visible tbody').innerText()).includes(marker));
  assert(await b.page.locator('[data-key="aiGuidePrepared"]').isChecked());
  await b.page.setViewportSize({width:1440,height:900});
  await b.page.screenshot({path:path.join(root,'outputs/全新工作区恢复.png')});
  await stop(b);
  // Failed publication must retain the previous manifest and the local database.
  const c=await start(bFolder,bMachine,null,true);
  const before=fs.readFileSync(path.join(bFolder,'workspace.json'),'utf8');
  fs.renameSync(path.join(bFolder,'backups'),path.join(bFolder,'backups-withheld'));
  await stop(c,1);
  assert.equal(fs.readFileSync(path.join(bFolder,'workspace.json'),'utf8'),before);
  assert(fs.existsSync(path.join(c.info.runtime,'data/document.db')));
  fs.renameSync(path.join(bFolder,'backups-withheld'),path.join(bFolder,'backups'));
  reject(['--new',a.folder],/空文件夹/);
  const invalid=path.join(run,'invalid.db');fs.writeFileSync(invalid,'not SQLite');
  const invalidTarget=path.join(run,'invalid-target');
  reject(['--new',invalidTarget,'--restore',invalid],/数据库操作未完成/);
  assert(!fs.existsSync(invalidTarget));
  const normalLaunch=await checkMovedNormalLaunch();
  const report={result:'PASS',scope:'same Mac, automated native renderer; physical chooser and Cmd-Q pending unlock',run,A:a.info,B:b.info,aBackup,bBackup:backup(bFolder),nativeBackup,normalLaunch,expected,overflow,checks:['official blank initialization','trusted local package confirmation','native spreadsheet edit','search','disable and re-enable','reimport preserves edits','preparation persists without AI connection','native backup','exit publication','new folder + new runtime/profile restore','failed publication retains manifest and local data','nonempty restore target rejected','invalid backup rejected','duplicate open rejected','moved app initializes and restarts without debug port']};
  fs.writeFileSync(path.join(root,'work/recovery-check.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
})().catch(async e=>{for(const session of sessions)await session.page.screenshot({path:path.join(run,'failure.png')}).catch(()=>{});console.error(e);process.exitCode=1}).finally(async()=>{for(const session of sessions){await session.browser.close().catch(()=>{});if(session.child.exitCode===null){try{process.kill(Number(session.info.pid),'SIGTERM')}catch{}}}for(const child of children)child.kill('SIGTERM')});
