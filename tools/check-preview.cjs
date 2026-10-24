// Inspect native search and hover previews in the existing isolated window.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const info=JSON.parse(fs.readFileSync(path.join(root,'work/ui-instance.json')));
 assert(info.debugPort&&info.runtime.startsWith(path.join(root,'work')+path.sep));
 const browser=await chromium.connectOverCDP('http://127.0.0.1:'+info.debugPort),context=browser.contexts()[0];
 fs.mkdirSync(path.join(root,'work/preview-ui'),{recursive:true});
 try{
  await context.tracing.start({screenshots:true,snapshots:true});
  const page=context.pages().find(p=>p.url().startsWith('trilium-app://app/')),errors=[];
  const originalTabs=await page.locator('.note-tab').evaluateAll(tabs=>tabs.map(tab=>tab.dataset.ntxId));
  page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1200,height:900});
  if(!await page.locator('.search-definition-widget:visible').count()){
   await page.locator('.tw-nav-rail [aria-label="查找资料"]').click();
   const find=page.locator('.tw-find:visible');await find.locator('input[type=search]').fill('备份');
   await find.locator('.tw-find-advanced summary').click();await find.locator('.tw-find-native').click();
  }
  const search=page.locator('.search-definition-widget:visible');
  await search.locator('.cm-content').fill('备份');await search.locator('.cm-content').press('Enter');
  const guide=page.locator('.search-result-card[href^="#twYingGuide"]:visible');await guide.waitFor();
  assert.equal(await search.locator('.btn').first().evaluate(e=>getComputedStyle(e).fontSize),'13px');
  const overflow=[];
  for(const width of [1200,1024,390]){
   await page.mouse.move(20,20);await page.setViewportSize({width,height:900});
   await guide.hover();const tooltip=page.locator('.note-tooltip:visible');await tooltip.waitFor();
   assert.equal(await tooltip.locator('.note-tooltip-title').evaluate(e=>getComputedStyle(e).fontSize),'14px');
   assert.equal(await tooltip.locator('.note-path').evaluate(e=>getComputedStyle(e).fontSize),'11px');
   assert.equal(await tooltip.locator('.ck-content').evaluate(e=>getComputedStyle(e).fontSize),'13px');
   assert.equal(await tooltip.locator('.ck-content pre').count(),0);
   assert.equal(await tooltip.locator('.ck-content ol > li').count(),7);
   assert.equal(await tooltip.locator('.ck-content :is(h1,h2)').count(),0);
   await tooltip.locator('.open-popup-button').scrollIntoViewIfNeeded();
   assert(await tooltip.locator('.open-popup-button').evaluate(button=>button.getBoundingClientRect().top>=button.previousElementSibling.getBoundingClientRect().bottom));
   await tooltip.locator('.note-tooltip-title').scrollIntoViewIfNeeded();
   const geometry=await tooltip.evaluate(tip=>{
    const r=tip.getBoundingClientRect(),content=tip.querySelector('.note-tooltip-content');
    const table=document.querySelector('.search-definition-widget .search-setting-table');
    const options=document.querySelector('.search-definition-widget .add-search-option');
    return{width:innerWidth,document:document.documentElement.scrollWidth-document.documentElement.clientWidth,table:table.scrollWidth-table.clientWidth,options:options.scrollWidth-options.clientWidth,preview:content.scrollWidth-content.clientWidth,left:r.left,right:r.right,scrollable:content.scrollHeight>content.clientHeight};
   });
   assert.equal(geometry.document,0);assert.equal(geometry.table,0);assert.equal(geometry.options,0);assert.equal(geometry.preview,0);
   assert(geometry.left>=0&&geometry.right<=width);overflow.push(geometry);
   if(width!==1024)await page.screenshot({path:path.join(root,'outputs',width===1200?'笔记预览排版.png':'笔记预览窄窗.png'),animations:'disabled'});
  }
  await page.mouse.move(20,20);await page.setViewportSize({width:1200,height:900});
  const recovery=page.locator('.search-result-card[href^="#twYingRecovery"]:visible');await recovery.hover();
  const tooltip=page.locator('.note-tooltip:visible');await tooltip.waitFor();
  assert.equal(await tooltip.locator('.ck-content h2').evaluate(e=>getComputedStyle(e).fontSize),'16px');
  await page.screenshot({path:path.join(root,'outputs/其他笔记预览.png'),animations:'disabled'});
  await page.mouse.move(20,20);await guide.hover();await tooltip.locator('a[href="#twYingGuide"]').click();
  await page.locator('.note-detail-editable-text:visible .ck-content').waitFor();
  assert.equal(await page.locator('.note-detail-editable-text:visible .ck-content pre').count(),0);
  assert.equal(await page.locator('.note-detail-editable-text:visible .ck-content ol > li').count(),7);
  const documentLayout=[];
  for(const width of [1200,1024,390]){
   await page.setViewportSize({width,height:900});
   const layout=await page.locator('.inline-title:visible').evaluate(title=>{
    const body=document.querySelector('.note-detail-editable-text.visible .ck-content'),icon=title.querySelector('.note-icon'),input=title.querySelector('input.note-title');
    return{width:innerWidth,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,titleSize:getComputedStyle(input).fontSize,bodySize:getComputedStyle(body).fontSize,iconWidth:icon.getBoundingClientRect().width,gap:body.getBoundingClientRect().top-title.getBoundingClientRect().bottom};
   });
   assert.equal(layout.overflow,0);assert.equal(layout.titleSize,'18px');assert.equal(layout.bodySize,'14px');assert.equal(layout.iconWidth,36);assert(layout.gap>=8&&layout.gap<=24);documentLayout.push(layout);
   if(width!==1024)await page.screenshot({path:path.join(root,'outputs',width===1200?'说明文档排版.png':'说明文档窄窗.png'),animations:'disabled'});
  }
  await page.setViewportSize({width:1200,height:900});
  for(const id of await page.locator('.note-tab').evaluateAll(tabs=>tabs.map(tab=>tab.dataset.ntxId))){
   if(!originalTabs.includes(id))await page.locator(`.note-tab[data-ntx-id="${id}"] .note-tab-close`).click();
  }
  assert.deepEqual(errors,[]);
  const report={result:'PASS',checks:['native search uses 13px controls','preview title/path/body hierarchy','native guide paragraphs and seven steps','no duplicate guide heading or pre block','other document headings use preview scale','full document title/icon/body spacing','390/1024 overflow'],overflow,documentLayout};
  fs.writeFileSync(path.join(root,'work/preview-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await context.tracing.stop({path:path.join(root,'work/preview-ui/trace.zip')});await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
