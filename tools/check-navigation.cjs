// Exercise the shared shell in one already-running, synthetic Trilium instance.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),info=JSON.parse(fs.readFileSync(path.join(root,'work/ui-instance.json')));
(async()=>{
 const browser=await chromium.connectOverCDP('http://127.0.0.1:'+info.debugPort);
 try {
  const page=browser.contexts()[0].pages().find(p=>p.url().startsWith('trilium-app://app/'));
  if (await page.locator('.modal.show .btn-close').count()) { await page.locator('.modal.show .btn-close').click();await page.locator('.modal.show').waitFor({state:'hidden'}); }
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  async function run(script,params=[]) {
   return page.evaluate(async ({script,params})=>{const r=await fetch('api/script/exec',{method:'POST',headers:{...glob.getHeaders(),'Content-Type':'application/json'},body:JSON.stringify({script,params,startNoteId:'twBootstrap',currentNoteId:'twBootstrap',originEntityName:'notes',originEntityId:'root',transactional:true})});const d=await r.json();if(!d.success)throw new Error(d.error||JSON.stringify(d));return d.executionResult;},{script,params});
  }
  const original=await run('()=>({format:api.getNote("root").getLabelValue("workbenchFormat"),preferences:JSON.parse(api.getNote("twNavigationData").getContent()),sheet:api.getNote("twYingSheet").getContent(),preparation:api.getNote("twYingPreparation").getContent()})');
  assert.equal(original.format,'1');
  await assert.rejects(run(fs.readFileSync(path.join(root,'src/navigation-actions.js'),'utf8'),['save',{...original.preferences,shortcuts:[{rootId:'root',pinned:true,glyph:'',expanded:true}]}]),/侧栏设置无效/);
  const customize=async()=>{await page.locator('.tw-nav-customize').click();await page.locator('.tw-nav-dialog[open]').waitFor();};
  const save=async()=>{await page.getByRole('button',{name:'保存侧栏',exact:true}).click();await page.locator('.tw-nav-dialog').waitFor({state:'detached'});};
  const home=async()=>{await page.locator('.tw-nav-rail').getByRole('button',{name:'我的工作台',exact:true}).click();await page.getByRole('heading',{name:'把需要的工作，放在手边。',exact:true}).waitFor();};
  await page.setViewportSize({width:1200,height:860});await home();
  if (!await page.locator('.tw-nav-child').count()) { await page.locator('.tw-nav-expand').click();await page.locator('.tw-nav-child').first().waitFor(); }
  await page.locator('.left-pane-toggle-button').click();await page.locator('#left-pane').waitFor({state:'hidden'});await home();await page.locator('#left-pane').waitFor({state:'visible'});
  assert.equal(await page.locator('#launcher-container > button[data-trigger-command="createNoteIntoInbox"]:visible').count(),0);
  assert.equal(await page.locator('.tw-nav-rail').getByRole('button',{name:'荧小助 · 学生管理',exact:true}).locator('.tw-nav-glyph').innerText(),'荧');
  await page.screenshot({path:path.join(root,'outputs/通用工作台导航.png')});
  await customize();await page.screenshot({path:path.join(root,'outputs/快捷入口设置.png')});
  const row=page.locator('.tw-shortcut-setting[data-root-id="twYing"]');await row.getByRole('combobox').selectOption('📋');
  await page.locator('.tw-tool-choices').getByLabel('新建笔记',{exact:true}).check();await save();
  assert.equal(await page.locator('.tw-nav-rail [aria-label="荧小助 · 学生管理"] .tw-nav-glyph').innerText(),'📋');
  await page.locator('.tw-nav-rail').getByRole('button',{name:'新建笔记',exact:true}).waitFor();
  await page.screenshot({path:path.join(root,'outputs/自选快捷图标.png')});
  await run(fs.readFileSync(path.join(root,'src/bootstrap.js'),'utf8'),[JSON.parse(fs.readFileSync(path.join(root,'work/build/bundle.json')))]);
  await page.reload();await page.locator('#splash').waitFor({state:'hidden'});await page.locator('.tw-nav-open').waitFor();
  assert.equal(await page.locator('.tw-nav-rail [aria-label="荧小助 · 学生管理"] .tw-nav-glyph').innerText(),'📋');
  await customize();await row.getByRole('checkbox').uncheck();await save();
  assert.equal(await page.locator('.tw-nav-open').count(),0);
  assert.equal(await page.locator('.tw-nav-rail [aria-label="荧小助 · 学生管理"]').count(),0);
  const preserved=await run('()=>({sheet:api.getNote("twYingSheet").getContent(),preparation:api.getNote("twYingPreparation").getContent()})');
  assert.equal(preserved.sheet,original.sheet);assert.equal(preserved.preparation,original.preparation);
  await page.screenshot({path:path.join(root,'outputs/取消固定保留资料.png')});
  await customize();await row.getByRole('checkbox').check();await row.getByRole('combobox').selectOption('');
  await page.locator('.tw-tool-choices').getByLabel('新建笔记',{exact:true}).uncheck();await save();
  await page.locator('.tw-nav-expand').click();await page.locator('.tw-nav-child').first().waitFor({state:'detached'});assert.equal(await page.locator('.tw-nav-child').count(),0);
  await page.reload();await page.locator('#splash').waitFor({state:'hidden'});await page.locator('.tw-nav-open').waitFor();
  assert.equal(await page.locator('.tw-nav-child').count(),0);
  assert.equal(await page.locator('.tw-nav-rail [aria-label="荧小助 · 学生管理"] .tw-nav-glyph').innerText(),'荧');
  await page.locator('.tw-nav-expand').click();await page.locator('.tw-nav-child').first().waitFor();
  await page.locator('.tw-nav-open').click();await page.getByRole('heading',{name:'学生管理',exact:true}).waitFor();
  await page.screenshot({path:path.join(root,'outputs/快捷导航学生范例.png')});
  await page.locator('.tw-nav-child').filter({hasText:/^学生总表$/}).click();await page.locator('.spreadsheet input[class*="univer-appearance-none"]').waitFor();
  await home();
  await page.locator('.tw-nav-rail').getByRole('button',{name:'更多工具',exact:true}).click();await page.locator('.tw-nav-dialog[open]').waitFor();
  assert((await page.locator('.tw-nav-dialog').innerText()).includes('7 天'));await page.screenshot({path:path.join(root,'outputs/常用与更多工具.png')});
  await page.locator('.tw-nav-dialog').getByRole('button',{name:'回收站',exact:true}).click();
  await page.getByRole('dialog').filter({hasText:'已删除的笔记'}).waitFor();
  await page.waitForFunction(()=>+getComputedStyle(document.querySelector('.modal.show')).opacity>.99);
  await page.screenshot({path:path.join(root,'outputs/原生回收站入口.png')});
  await page.locator('.modal.show .btn-close').click();await page.locator('.modal.show').waitFor({state:'hidden'});
  await page.locator('.tw-tree-toggle').click();await page.locator('.tree-wrapper .fancytree-title').filter({hasText:/^我的工作台$/}).waitFor();await page.locator('.tw-tree-toggle').click();await page.locator('.tree-wrapper .tree').waitFor({state:'hidden'});
  await customize();await page.getByLabel('同时显示 Trilium 原生工具栏',{exact:true}).check();await save();
  await page.locator('#launcher-container > button[data-trigger-command="createNoteIntoInbox"]').waitFor({state:'visible'});
  await customize();await page.getByLabel('同时显示 Trilium 原生工具栏',{exact:true}).uncheck();await save();
  await customize();await row.getByRole('checkbox').uncheck();await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.locator('.tw-nav-open').count(),1);
  const overflow=[];
  for (const width of [1200,1024,852,390]) {
   await page.setViewportSize({width,height:860});
   const report=await page.evaluate(()=>({document:document.documentElement.scrollWidth-document.documentElement.clientWidth,nav:document.querySelector('.tw-nav-side').scrollWidth-document.querySelector('.tw-nav-side').clientWidth,centers:[...document.querySelectorAll('.tw-rail-button')].map(e=>{const r=e.getBoundingClientRect();return r.x+r.width/2}),footer:document.querySelector('.tw-tree-toggle').getBoundingClientRect().y-document.querySelector('.status-bar-main-row').getBoundingClientRect().y,moreBottom:document.querySelector('.tw-rail-button[aria-label="更多工具"]').getBoundingClientRect().bottom,railBottom:document.querySelector('#launcher-container').getBoundingClientRect().bottom}));
   assert.equal(report.document,0);assert.equal(report.nav,0);for(const x of report.centers)assert.equal(x,22);
   assert(Math.abs(report.footer)<1);assert(report.moreBottom<=report.railBottom);overflow.push({width,...report});
   await customize();const modal=await page.locator('.tw-nav-dialog').evaluate(e=>({overflow:e.scrollWidth-e.clientWidth,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right}));assert.equal(modal.overflow,0);assert(modal.left>=0&&modal.right<=width);if(width===390)await page.screenshot({path:path.join(root,'outputs/快捷入口窄窗.png')});await page.locator('.tw-dialog-close').click();
  }
  await run('preferences=>{api.getNote("twNavigationData").setContent(JSON.stringify(preferences));return true}',[original.preferences]);
  await page.reload();await page.locator('#splash').waitFor({state:'hidden'});await page.locator('.tw-nav-open').waitFor();await page.setViewportSize({width:1200,height:860});await home();await page.screenshot({path:path.join(root,'outputs/通用工作台导航.png')});
  assert.deepEqual(errors,[]);
  const report={result:'PASS',checks:['shared package installation (check-install)','initial or chosen symbol with full labels','native note navigation and spreadsheet','pin/unpin preserves data','preferences survive reload','cancel discards changes','native tools opt-in','native recycle bin','wide and narrow geometry'],overflow};fs.writeFileSync(path.join(root,'work/navigation-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
