// Reuse one already-running isolated Electron window; never start more instances.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
  const instance=JSON.parse(fs.readFileSync(path.join(root,'work/ui-instance.json')));
  const browser=await chromium.connectOverCDP('http://127.0.0.1:'+instance.debugPort);
  try {
    const page=browser.contexts()[0].pages().find(p=>p.url().startsWith('trilium-app://app/'));
    const treeToggle=page.locator('.tw-tree-toggle');
    const revealTree=await treeToggle.count() && await treeToggle.getAttribute('aria-expanded')==='false';
    if(revealTree) {await treeToggle.click();await page.locator('.tree-wrapper .fancytree-title').first().waitFor();}
    await page.locator('.tree-wrapper .fancytree-title').filter({hasText:/^我的工作台$/}).click();
    await page.locator('.tw:visible').waitFor();
    await page.locator('#splash').waitFor({state:'hidden'});
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('.note-tab-wrapper')).every(e=>e.getBoundingClientRect().width<=180));
    async function auditChrome() {
      const data=await page.evaluate(()=>{
        const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2}};
        const one=s=>box(Array.from(document.querySelectorAll(s)).find(e=>e.getBoundingClientRect().height));
        const rail=one('#launcher-pane'),logo=one('#launcher-pane .global-menu svg');
        const buttons=Array.from(document.querySelectorAll('#launcher-pane .launcher-button')).filter(e=>e.getBoundingClientRect().height).map(box);
        const search=one('.quick-search .search-string'),placeholder=one('.quick-search .cm-placeholder');
        const tree=one('.fancytree-container > li > .fancytree-node');
        const toolbar=one('.note-split-title'),title=one('.note-title-widget input.note-title'),sideHome=one('.tw-side-home'),allNotes=one('.tw-tree-toggle'),toggle=one('.left-pane-toggle-button'),dots=one('.tree-actions'),status=one('.status-bar-main-row'),home=one('.status-bar .root-note');
        const wrapper=document.querySelector('#left-pane .tree-wrapper'),footerStyle=getComputedStyle(wrapper,'::after');
        return {rail,logo,buttons,search,placeholder,tree,toolbar,title,sideHome,allNotes,toggle,dots,status,home,treeFooterTop:wrapper.getBoundingClientRect().bottom-parseFloat(footerStyle.height),searchFont:getComputedStyle(document.querySelector('.quick-search .cm-scroller')).fontSize};
      });
      for(const button of data.buttons)assert(Math.abs(button.cx-data.rail.cx)<0.6,'rail button has a different center line');
      assert(Math.abs(data.logo.cx-data.rail.cx)<0.6);
      assert(data.logo.x-data.rail.x>=8 && data.rail.x+data.rail.width-data.logo.x-data.logo.width>=8,'logo touches the rail edge');
      assert.equal(data.searchFont,'13px');
      assert(data.placeholder.x-data.search.x>=8,'search text touches its field edge');
      assert(Math.abs(data.search.x-data.tree.x)<0.6,'search field and tree rows have different outer insets');
      const headerCenters=[data.logo.cy,data.placeholder.cy,data.toolbar.cy];
      assert(Math.max(...headerCenters)-Math.min(...headerCenters)<1,'header items are not on the same row');
      assert.equal(data.toggle.height,data.status.height);
      for(const bar of [data.toolbar,data.sideHome,data.allNotes])assert.equal(bar.height,data.status.height,'top and bottom bars have different heights');
      assert(Math.abs(data.title.cy-data.toolbar.cy)<1,'title is not centered in its bar');
      assert(data.title.y-data.toolbar.y>=4 && data.toolbar.y+data.toolbar.height-data.title.y-data.title.height>=4,'title touches its bar edge');
      assert(Math.abs(data.toggle.y-data.status.y)<0.6 && Math.abs(data.treeFooterTop-data.status.y)<0.6,'footer bands start at different heights');
      assert(Math.abs(data.dots.cy-data.home.cy)<1 && Math.abs(data.toggle.cy-data.home.cy)<1,'footer controls have different center lines');
      return data;
    }
    const shell=await page.evaluate(()=>{
      const read=selector=>{const el=Array.from(document.querySelectorAll(selector)).find(e=>e.getBoundingClientRect().height);const css=getComputedStyle(el),r=el.getBoundingClientRect();return {font:parseFloat(css.fontSize),width:r.width,height:r.height}};
      return {body:read('body'),tabBar:read('.tab-row-widget'),tab:read('.note-tab-wrapper'),tree:read('.fancytree-title'),treeRow:read('.fancytree-node'),launcher:read('#launcher-pane'),toolbar:read('.note-split-title'),title:read('.note-title-widget input')};
    });
    assert.equal(shell.body.font,14);assert.equal(shell.tab.font,13);assert(shell.tab.width<=180);
    assert.equal(shell.tabBar.height,36);assert.equal(shell.tree.font,13);assert.equal(shell.treeRow.height,28);
    assert.equal(shell.launcher.width,44);assert.equal(shell.toolbar.height,36);assert.equal(shell.title.font,14);
    await page.setViewportSize({width:1200,height:860});
    await page.screenshot({path:path.join(root,'outputs/整体尺寸调整后.png')});
    // The native layout still places adjacent tabs together after its width cap.
    const tabs=await page.evaluate(()=>{const c=glob.getComponentByEl(document.querySelector('.tab-row-widget'));return {widths:c.tabWidths,positions:c.getTabPositions().tabPositions}});
    for(let i=0;i<tabs.widths.length;i++){assert(tabs.widths[i]<=180);if(i)assert(tabs.positions[i]-tabs.positions[i-1]-tabs.widths[i-1]<10)}
    await page.getByRole('button',{name:'打开工作台',exact:true}).click();
    await page.getByRole('heading',{name:'学生管理',exact:true}).waitFor();
    const search=page.getByPlaceholder('姓名、课题组或设备');await search.fill('示例乙组');
    assert.equal(await page.locator('.tw:visible tbody tr').count(),1);await search.fill('');
    const overflow=[],alignment=[];
    for(const width of [1200,1024,852,390]) {
      await page.setViewportSize({width,height:860});
      alignment.push({width,...await auditChrome()});
      const result=await page.evaluate(()=>({document:document.documentElement.scrollWidth-document.documentElement.clientWidth,workbench:Math.max(...Array.from(document.querySelectorAll('.tw')).filter(e=>e.offsetWidth).map(e=>e.scrollWidth-e.clientWidth))}));
      assert.equal(result.document,0);assert.equal(result.workbench,0);overflow.push({width,...result});
      if(width===852)await page.screenshot({path:path.join(root,'outputs/Notion同宽尺寸.png')});
    }
    await page.setViewportSize({width:1200,height:860});
    await page.screenshot({path:path.join(root,'outputs/学生页紧凑尺寸.png')});
    await page.screenshot({path:path.join(root,'outputs/学生页对齐修正.png')});
    await page.locator('.tree-actions').hover();
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('.tree-actions button')).every(e=>parseFloat(getComputedStyle(e).opacity)>.99));
    const hover=await page.locator('.tree-actions').evaluate(e=>{const r=e.getBoundingClientRect();return {width:r.width,buttons:Array.from(e.querySelectorAll('button')).map(b=>{const v=b.getBoundingClientRect();return {left:v.left-r.left,right:r.right-v.right}})}});
    assert(hover.width>80);for(const b of hover.buttons){assert(b.left>=0);assert(b.right>=0)}
    await page.screenshot({path:path.join(root,'outputs/底栏操作展开.png')});
    await page.mouse.move(600,100);
    await page.getByRole('button',{name:'打开完整表格',exact:true}).click();
    await page.locator('.spreadsheet input[class*="univer-appearance-none"]').waitFor();
    await page.screenshot({path:path.join(root,'outputs/原生表格紧凑尺寸.png')});
    // Native tab close still works with the existing Trilium layout engine.
    const before=await page.locator('.note-tab').count();
    await page.locator('.note-new-tab').click();
    await page.waitForFunction(count=>document.querySelectorAll('.note-tab').length===count,before+1);
    await page.locator('.note-tab[active] .note-tab-close').click();
    await page.waitForFunction(count=>document.querySelectorAll('.note-tab').length===count,before);
    await page.locator('.tree-wrapper .fancytree-title').filter({hasText:/^我的工作台$/}).click();
    await page.locator('.tw:visible').waitFor();
    if(revealTree) {await treeToggle.click();await page.locator('.tree-wrapper .tree').waitFor({state:'hidden'});}
    const report={result:'PASS',shell,tabs,overflow,alignment,hover,checks:['native chrome scale','rail centers and logo clearance','search typography and insets','header row alignment','three footer bands and control centers','native hover actions','tab width and contiguous layout','native tab close','search','full native spreadsheet opens']};
    fs.writeFileSync(path.join(root,'work/scale-check.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  } finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
