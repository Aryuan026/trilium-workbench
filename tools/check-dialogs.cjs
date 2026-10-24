// Inspect native menus and dialogs in the existing synthetic window; no setting writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const i=JSON.parse(fs.readFileSync(path.join(root,'work/ui-instance.json')));
 assert(i.debugPort&&i.runtime.startsWith(path.join(root,'work')+path.sep));
 const b=await chromium.connectOverCDP('http://127.0.0.1:'+i.debugPort);
 try{
  const p=b.contexts()[0].pages().find(p=>p.url().startsWith('trilium-app://app/'));
  const reports=[];
  const home=async()=>{await p.locator('.tw-nav-rail [aria-label="我的工作台"]').click();await p.getByRole('heading',{name:'把需要的工作，放在手边。',exact:true}).waitFor();};
  const font=async(selector,size)=>{for(const value of await p.locator(selector).evaluateAll(es=>es.filter(e=>e.getBoundingClientRect().width&&getComputedStyle(e).visibility!=='hidden').map(e=>getComputedStyle(e).fontSize)))assert.equal(value,size,selector);};
  const close=async()=>{await p.locator('.modal.show .btn-close').click();await p.locator('.modal.show').waitFor({state:'hidden'});};
  async function menu(command){await p.locator('.global-menu-button').click();await p.locator('.dropdown-menu.show [data-trigger-command="'+command+'"]').click();}
  async function check(name,file){
   await p.locator('.modal.show').waitFor();await p.waitForFunction(()=>+getComputedStyle(document.querySelector('.modal.show')).opacity>.99);
   await font('.modal.show','13px');await font('.modal.show .modal-title','16px');
   await font('.modal.show :is(.btn:not(.custom-title-bar-button),.form-control,.form-select)','13px');
   await font('.modal.show :is(small,.form-text,.tn-card-option-description,.tn-card-description,.note-path,kbd)','12px');
   const widths=[];
   for(const width of[1200,1024,390]){
    await p.setViewportSize({width,height:860});
    const geometry=await p.locator('.modal.show').evaluate(m=>({document:document.documentElement.scrollWidth-document.documentElement.clientWidth,overflow:m.scrollWidth-m.clientWidth,content:[...m.querySelectorAll('.modal-content,.modal-body')].map(e=>e.scrollWidth-e.clientWidth),left:m.querySelector('.modal-dialog').getBoundingClientRect().left,right:m.querySelector('.modal-dialog').getBoundingClientRect().right}));
    assert.equal(geometry.document,0,name);assert.equal(geometry.overflow,0,name);
    for(const n of geometry.content)assert.equal(n,0,name+' content overflow');
    assert(geometry.left>=0&&geometry.right<=width,name+' outside window');widths.push({width,...geometry});
   }
   await p.setViewportSize({width:1200,height:860});if(file)await p.screenshot({path:path.join(root,'outputs',file)});
   reports.push({name,widths});
  }
  await p.setViewportSize({width:1200,height:860});await home();
  await p.locator('.global-menu-button').click();await font('.dropdown-menu.show .dropdown-item','13px');
  await p.locator('.dropdown-menu.show .dropdown-submenu').filter({hasText:'高级'}).hover();
  await font('.dropdown-submenu .dropdown-menu .dropdown-item','13px');await p.screenshot({path:path.join(root,'outputs/原生下级菜单.png')});await p.keyboard.press('Escape');await p.mouse.move(600,100);
  for(const[command,name,file]of[['showDeletedNotes','回收站','已删除笔记统一字号.png'],['showOptions','软件设置','原生设置统一字号.png'],['showCheatsheet','快捷帮助','快捷帮助统一字号.png'],['openAboutDialog','关于','关于统一字号.png']]){
   await menu(command);await check(name,file);
   if(command==='showDeletedNotes')assert((await p.locator('.modal.show').innerText()).includes('7 天'));
   if(command==='showOptions'){
    await font('.modal.show .options-page-header-title','16px');await font('.modal.show .tn-card-heading','13px');
    for(const label of['语言和区域','快捷键','备份']){await p.locator('.settings-navigation-title').filter({hasText:new RegExp('^'+label+'$')}).click();await p.locator('.options-page-header-title').filter({hasText:new RegExp('^'+label+'$')}).waitFor();await check('设置 / '+label);}
   }
   if(command==='showCheatsheet'){await font('.help-dialog .card-title','14px');await font('.help-dialog h6','13px');}
   if(command==='openAboutDialog'){await font('.about-dialog h2','20px');await font('.about-dialog .property-sheet','13px');await font('.about-dialog .build-info','12px');}
   await close();
  }
  await p.locator('.tw-nav-rail [aria-label="更多工具"]').click();await p.locator('.tw-nav-dialog').getByRole('button',{name:'最近更改',exact:true}).click();await check('最近更改','最近更改统一字号.png');await font('.recent-changes-content > div > b','14px');await close();
  await home();await p.locator('.tw-nav-open').click();await p.getByRole('heading',{name:'学生管理',exact:true}).waitFor();
  const selected=await p.evaluate(()=>{const badge=document.querySelector('.tw-nav-mark'),row=document.querySelector('.tw-nav-row[data-active]'),rail=document.querySelector('.tw-rail-button[aria-current]');return{badge:getComputedStyle(badge).backgroundColor,glyph:getComputedStyle(badge).color,row:getComputedStyle(row).backgroundColor,rail:getComputedStyle(rail).backgroundColor,railGlyph:getComputedStyle(rail).color}});
  assert.notEqual(selected.badge,selected.row);assert.equal(selected.glyph,'rgb(255, 255, 255)');assert.equal(selected.railGlyph,'rgb(255, 255, 255)');await p.screenshot({path:path.join(root,'outputs/经典配色学生范例.png')});
  await home();await p.screenshot({path:path.join(root,'outputs/经典配色与等高栏.png')});
  fs.writeFileSync(path.join(root,'work/dialog-check.json'),JSON.stringify({result:'PASS',reports,selected},null,2));
  console.log(JSON.stringify({result:'PASS',dialogs:reports.map(x=>x.name),selected}));
 }finally{await b.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
