// Local development assembly; native Trilium remains the storage/editor runtime.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, 'src', name), 'utf8');
const label = (name, value) => ({type:'label', name, value, isInheritable:false});
const note = (noteId, parentNoteId, title, type, content, extra={}) => ({noteId,parentNoteId,title,type,content,...extra});
const code = (id, parent, title, content, env='frontend') => note(id,parent,title,'code',content,{mime:`application/javascript;env=${env}`,attributes:[label('scriptEnv',env)]});
const headers = ['姓名','课题组','设备','权限起始','权限到期','在籍状态'];
const rows = [headers,
  ['示例学生一','示例甲组','示例共聚焦','2026-10-01','2027-09-30','在籍'],
  ['示例学生二','示例乙组','示例光片','2026-09-15','2027-09-14','在籍'],
  ['示例学生三','示例甲组','示例共聚焦','2025-09-01','2026-08-31','离校']];
const cellData = Object.fromEntries(rows.map((row,r)=>[r,Object.fromEntries(row.map((v,c)=>[c,{v,t:1}]))]));
const workbook = {version:1,workbook:{id:'ying-demo',name:'学生总表',appVersion:'0.106.1',locale:'zhCN',sheetOrder:['students'],sheets:{students:{id:'students',name:'学生总表',rowCount:200,columnCount:12,defaultColumnWidth:150,defaultRowHeight:26,cellData,freeze:{xSplit:0,ySplit:1,startRow:1,startColumn:0}}}}};
const aiGuide = read('AI-GUIDE.md');
const pkg = {format:'trilium-workbench-package',schemaVersion:1,id:'ying-students',version:'0.2.0-demo',title:'荧小助 · 学生管理',description:'本地名册、完整表格与资料整理。先在合成资料上试用，再接入已有学生处理流程。',rootId:'twYing',rendererId:'twYingUI',dataId:'twYingSheet',preparationId:'twYingPreparation',notes:[
  note('twYing','root','荧小助 · 学生管理','render','',{notePosition:10}),
  note('twYingSheet','twYing','学生总表','spreadsheet',JSON.stringify(workbook)),
  note('twYingGuide','twYing','资料准备与 AI 指引','text',aiGuide.replace(/^# [^\n]+\n+/,''),{contentFormat:'markdown'}),
  note('twYingRecovery','twYing','备份与恢复','text','<h2>备份与恢复</h2><p>目录中的「创建完整备份」调用 Trilium 原生备份。通过本项目启动器打开时，退出 Trilium（⌘Q）后会把完整快照写入选定工作区。</p><p>所选工作区文件夹只保存完成的备份和可移植元数据；实际编辑的 SQLite、缓存和机器配置留在本机。</p><p>启动器可把完整 .db 备份恢复到另一个新空目录，找回模块、表格与准备进度；原文件不改。</p><p>目前只验同机未加密 .db 恢复，第二设备、Windows 与加密容器分别验收。</p>'),
  note('twYingSources','twYing','工作包源码','text','<p>此处保存本工作包的界面代码，便于独立导出与审阅。</p>',{attributes:[label('workbenchInternal','true')]}),
  code('twYingUI','twYingSources','学生首页.js',read('ying-home.js')),
  note('twYingStyle','twYingSources','工作台样式.css','code',read('workbench.css'),{mime:'text/css',attributes:[label('appCss','')]}),
  note('twYingPreparation','twYingSources','资料准备进度.json','code',JSON.stringify({materialsReady:false,aiGuidePrepared:false}),{mime:'application/json'})
]};
const bundle = {packages:[pkg],notes:[
  note('twFind','root','查找资料','render','<p>按工作台、表格、文档和附件查找自己的资料。</p>',{notePosition:20,attributes:[label('iconClass','bx bx-search')]}),
  note('twResources','root','技术资料','text','<h2>技术资料</h2><p>工作台使用的源码与配置，随完整备份保存。日常查找请打开<a href="#root/twFind">查找资料</a>。</p><h3>界面与导航</h3><ul><li><a href="#root/twResources/twFindUI">查找资料界面</a></li><li><a href="#root/twResources/twCatalogUI">工作台管理界面</a></li><li><a href="#root/twResources/twNavigationWidget">快捷导航</a></li><li><a href="#root/twResources/twCompactShell">紧凑布局</a></li><li><a href="#root/twResources/twStyle">共享样式</a></li></ul><h3>装配与设置</h3><ul><li><a href="#root/twBootstrap">工作区装配</a></li><li><a href="#root/twResources/twInstaller">工作包安装</a></li><li><a href="#root/twResources/twCatalogData">工作包目录配置</a></li><li><a href="#root/twResources/twNavigationData">侧栏偏好</a></li><li><a href="#root/twResources/twNavigationActions">侧栏读写</a></li></ul>',{notePosition:900}),
  code('twFindUI','twResources','查找资料.js',read('find.js')),
  note('twCatalogData','twResources','私有工作台目录.json','code',JSON.stringify([pkg]),{mime:'application/json'}),
  code('twInstaller','twResources','工作包装配器.js',read('install-workbench.js'),'backend'),
  code('twCatalogUI','twResources','工作台目录.js',read('catalog.js')),
  note('twNavigationData','twResources','侧栏偏好.json','code',JSON.stringify({shortcuts:[],tools:['searchNotes','showDeletedNotes'],showTree:false,showNative:false}),{mime:'application/json'}),
  code('twNavigationActions','twResources','侧栏读写.js',read('navigation-actions.js'),'backend'),
  code('twNavigationWidget','twResources','工作台快捷导航.js',read('navigation.js')),
  note('twCompactShell','twResources','紧凑桌面.js','code',read('compact-shell.js'),{mime:'application/javascript;env=frontend',attributes:[label('scriptEnv','frontend'),label('run','frontendStartup')]}),
  note('twStyle','twResources','工作台样式.css','code',read('workbench.css'),{mime:'text/css',attributes:[label('appCss','')]})
]};
fs.mkdirSync(path.join(root,'outputs','packages'),{recursive:true});
fs.writeFileSync(path.join(root,'outputs','packages','ying-students.json'),JSON.stringify(pkg,null,2));
fs.writeFileSync(path.join(root,'outputs','packages','辅助AI指引.md'),aiGuide);
fs.mkdirSync(path.join(root,'work','build'),{recursive:true});
fs.writeFileSync(path.join(root,'work','build','bundle.json'),JSON.stringify(bundle));
console.log('Built catalog + independent synthetic student package.');
module.exports = bundle;
