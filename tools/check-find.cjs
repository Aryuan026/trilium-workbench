// Exercise everyday lookup in the existing isolated window; never opens another instance.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const info=JSON.parse(fs.readFileSync(path.join(root,'work/ui-instance.json')));
 assert(info.debugPort&&info.runtime.startsWith(path.join(root,'work')+path.sep));
 const browser=await chromium.connectOverCDP('http://127.0.0.1:'+info.debugPort);
 const context=browser.contexts()[0];
 fs.mkdirSync(path.join(root,'work/search-ui'),{recursive:true});
 try{
  await context.tracing.start({screenshots:true,snapshots:true});
  const page=context.pages().find(p=>p.url().startsWith('trilium-app://app/')),errors=[];
  const originalTabs=await page.locator('.note-tab').evaluateAll(tabs=>tabs.map(tab=>tab.dataset.ntxId));
  page.on('pageerror',error=>errors.push(error.message));
  const backend=script=>page.evaluate(async script=>{
   const response=await fetch('api/script/exec',{method:'POST',headers:{...glob.getHeaders(),'Content-Type':'application/json'},body:JSON.stringify({script,params:[],startNoteId:'twBootstrap',currentNoteId:'twBootstrap',originEntityName:'notes',originEntityId:'root',transactional:true})});
   const data=await response.json();if(!data.success)throw new Error(data.error);return data.executionResult;
  },script);
  const state=()=>backend('()=>Object.fromEntries(["twYingSheet","twYingPreparation","twNavigationData"].map(id=>[id,api.getNote(id).getContent()]))');
  const before=await state(), find=page.locator('.tw-find:visible');
  const open=async()=>{await page.locator('.tw-nav-rail [aria-label="查找资料"]').click();await page.getByRole('heading',{name:'查找资料',exact:true}).waitFor();await find.locator('[type=submit]:enabled').waitFor();};
  const filter=label=>find.locator('.tw-find-filters').getByRole('button',{name:new RegExp('^'+label+' \\d+$')}).click();
  const search=async text=>{await find.locator('input[type=search]').fill(text);await find.locator('[type=submit]').click();await find.locator('[type=submit]:enabled').waitFor();};
  const clear=async()=>{if(await find.locator('.tw-find-clear').isEnabled())await find.locator('.tw-find-clear').click();await find.locator('[type=submit]:enabled').waitFor();};
  await page.setViewportSize({width:1200,height:860});await open();await clear();await filter('全部');
  const scope=find.getByRole('checkbox',{name:'也搜索工作台内资料',exact:true});
  assert(!(await scope.isChecked()));assert.equal(await find.locator('.tw-find-row[href="#twYingSheet"]').count(),0);
  const fixtureId='scope'+require('node:crypto').randomUUID().replaceAll('-','');
  try{
   await backend(`()=>{api.createNewNote({noteId:'${fixtureId}',parentNoteId:'root',title:'合成论文 · 学生参与的光片研究',type:'text',content:'<p>仅用于搜索范围验证。</p>'});return true;}`);
   await find.locator('.tw-find-refresh').click();await find.locator('[type=submit]:enabled').waitFor();
   await find.locator(`.tw-find-row[href="#${fixtureId}"]`).waitFor();
   await search('学生');await find.locator(`.tw-find-row[href="#${fixtureId}"]`).waitFor();
   assert.equal(await find.locator('.tw-find-row[href="#twYingSheet"]').count(),0);
   await scope.check();await find.locator('[type=submit]:enabled').waitFor();
   await find.locator('.tw-find-row[href="#twYingSheet"]').waitFor();
   await page.screenshot({path:path.join(root,'outputs/包含工作台资料.png'),animations:'disabled'});
   await scope.uncheck();await find.locator('[type=submit]:enabled').waitFor();
   assert.equal(await find.locator('.tw-find-row[href="#twYingSheet"]').count(),0);
   await find.locator(`.tw-find-row[href="#${fixtureId}"]`).waitFor();
   await page.screenshot({path:path.join(root,'outputs/日常资料搜索范围.png'),animations:'disabled'});
  }finally{await backend(`()=>{api.getNote('${fixtureId}')?.deleteNote();return true;}`);}
  await clear();await scope.check();await find.locator('[type=submit]:enabled').waitFor();
  await find.locator('.tw-find-row[href="#twYingSheet"]').waitFor();
  assert.equal(await find.locator('.tw-find-advanced').getAttribute('open'),null);
  assert.equal(await find.locator('.tw-find-native').isVisible(),false);
  const native=await backend('()=>({ordinary:api.searchForNotes("",{includeArchivedNotes:false}).map(n=>n.noteId),technical:api.searchForNotes("#archived",{includeArchivedNotes:true}).map(n=>n.noteId)})');
  for(const id of ['twBootstrap','twResources','twNavigationData','twYingUI','twYingPreparation']){assert(!native.ordinary.includes(id),id);assert(native.technical.includes(id),id);}
  const ids=await find.locator('.tw-find-row').evaluateAll(rows=>rows.map(row=>row.getAttribute('href')));
  assert(ids.includes('#twYing'));assert(ids.includes('#twYingSheet'));assert(ids.includes('#twYingRecovery'));
  await filter('表格');assert.equal(await find.locator('.tw-find-group').count(),1);
  await find.locator('.tw-find-row[href="#twYingSheet"]').click();await page.locator('.spreadsheet input[class*="univer-appearance-none"]').waitFor();
  await open();await filter('全部');await search('学生总表');await find.locator('.tw-find-row[href="#twYingSheet"]').waitFor();
  await search('#archived');await page.getByRole('heading',{name:'没有找到匹配的资料',exact:true}).waitFor();
  assert(!(await find.locator('.tw-find-status').innerText()).includes('没有完成'));
  await clear();await filter('附件');await page.getByRole('heading',{name:'这个分类还没有资料',exact:true}).waitFor();
  await page.screenshot({path:path.join(root,'outputs/资料分类空状态.png'),animations:'disabled'});
  await filter('文档');await search('备份');await find.locator('.tw-find-row[href="#twYingRecovery"]').click();
  await page.getByRole('heading',{name:'备份与恢复',exact:true}).waitFor();
  await open();await clear();await filter('全部');await search('备份');
  await find.locator('.tw-find-advanced summary').click();await find.locator('.tw-find-native').click();
  await page.locator('.search-definition-widget').waitFor();assert((await page.locator('.search-definition-widget .search-string-editor .cm-content').innerText()).includes('备份'));
  await open();await find.locator('.tw-find-advanced summary').click();await find.locator('.tw-find-source').click();
  await page.getByRole('heading',{name:'技术资料',exact:true}).waitFor();
  await page.getByRole('heading',{name:'界面与导航',exact:true}).waitFor();await page.getByRole('heading',{name:'装配与设置',exact:true}).waitFor();
  await page.getByRole('link',{name:'侧栏偏好',exact:true}).click();await page.waitForURL(/twNavigationData/);
  await open();await clear();await filter('全部');await find.locator('.tw-find-refresh').click();await find.locator('[type=submit]:enabled').waitFor();
  for(const id of await page.locator('.note-tab').evaluateAll(tabs=>tabs.map(tab=>tab.dataset.ntxId))){
   if(!originalTabs.includes(id))await page.locator(`.note-tab[data-ntx-id="${id}"] .note-tab-close`).click();
  }
  await open();
  await page.reload();await find.locator('[type=submit]:enabled').waitFor();
  assert(!(await find.getByRole('checkbox',{name:'也搜索工作台内资料',exact:true}).isChecked()));
  assert.equal(await find.locator('.tw-find-row[href="#twYingSheet"]').count(),0);
  assert.equal(await find.locator('.tw-find-advanced').getAttribute('open'),null);
  await page.mouse.move(1100,100);
  const overflow=[];
  for(const width of [1200,1024,390]){
   await page.setViewportSize({width,height:860});
   const geometry=await find.evaluate(main=>({document:document.documentElement.scrollWidth-document.documentElement.clientWidth,main:main.scrollWidth-main.clientWidth,form:main.querySelector('.tw-find-input').scrollWidth-main.querySelector('.tw-find-input').clientWidth}));
   assert.equal(geometry.document,0);assert.equal(geometry.main,0);assert.equal(geometry.form,0);overflow.push({width,...geometry});
   if(width!==1024)await page.screenshot({path:path.join(root,'outputs',width===1200?'资料分类查找.png':'查找资料窄窗.png'),animations:'disabled'});
   if(width===390){await find.locator('.tw-find-advanced summary').click();assert(await find.locator('.tw-find-advanced').evaluate(details=>details.open));await find.locator('.tw-find-source').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(root,'outputs/查找高级入口.png'),animations:'disabled'});await find.locator('.tw-find-advanced summary').click();}
  }
  await page.setViewportSize({width:1200,height:860});
  assert.deepEqual(await state(),before);assert.deepEqual(errors,[]);
  const report={result:'PASS',checks:['daily scope excludes workbench root and descendants before native result limit','personal paper mentioning students remains searchable','include-workbenches toggle is reversible and reload defaults to daily','native archive inheritance excludes implementation from ordinary search','technical notes remain retrievable','human categories and empty state','literal keyword search and clear','native spreadsheet and document navigation','advanced search keeps the query','technical source links','refresh','workbook/preparation/navigation preserved'],ids,overflow};
  fs.writeFileSync(path.join(root,'work/find-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await context.tracing.stop({path:path.join(root,'work/search-ui/trace.zip')});await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
