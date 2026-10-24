// Generic loopback relay checks; no private business package or credentials required.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),vm=require('node:vm');
(async()=>{
 const server=http.createServer(async(req,res)=>{
  assert.equal(req.headers['x-workbench-token'],'synthetic-only');
  if(req.url==='/'){res.end('<!doctype html><html><meta charset="utf-8"><p>synthetic document</p></html>');return;}
  if(req.url==='/api/conflict'){res.writeHead(409);res.end(JSON.stringify({error:'资料已变化，请重新核对。'}));return;}
  if(req.url==='/api/redirect'){res.writeHead(307,{Location:'http://example.invalid/'});res.end();return;}
  if(req.url==='/api/broken'){res.end('not JSON');return;}
  let body='';for await(const chunk of req)body+=chunk;
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,bytes:Buffer.byteLength(body)}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const binding={rootId:'externalHome',origin:'http://127.0.0.1:'+server.address().port,token:'synthetic-only',routes:{state:'GET',edit:'POST',conflict:'POST',redirect:'GET',broken:'GET'},maxRequestBytes:3*1024*1024,launcherPid:12345};
 let enabled=true,killed=null;
 const notes={externalHome:{noteId:'externalHome',getLabelValue:name=>name==='workbenchEnabled'?(enabled?'true':'false'):'synthetic'},externalTable:{noteId:'externalTable',getLabelValue:()=> 'synthetic',hasAncestor:id=>id==='externalHome'},outsider:{noteId:'outsider',getLabelValue:()=> 'synthetic',hasAncestor:()=>false}};
 const context={api:{getNote:id=>notes[id]},process:{env:{TRILIUM_WORKBENCH_BINDINGS:JSON.stringify({synthetic:binding})},kill:(pid,signal)=>{killed={pid,signal};}},URL,TextEncoder,AbortSignal,fetch};
 vm.createContext(context);vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../src/external-request.js'),'utf8'),context);
 const request=context.externalRequest;
 try{
  assert((await request('externalHome',{document:true})).includes('<html><meta'));
  assert((await request('externalTable',{path:'state',method:'GET'})).ok);
  const large={data:'x'.repeat(2*1024*1024)};
  assert((await request('externalHome',{path:'edit',method:'POST',body:large})).bytes>2*1024*1024);
  await assert.rejects(request('externalHome',{path:'edit',method:'POST',body:{data:'x'.repeat(3*1024*1024)}}),/请求上限/);
  await assert.rejects(request('externalHome',{path:'state',method:'POST',body:{}}),/范围/);
  await assert.rejects(request('externalHome',{path:'../state',method:'GET'}),/范围/);
  await assert.rejects(request('outsider',{closeWorkspace:true}),/不属于/);assert.equal(killed,null);
  await assert.rejects(request('externalHome',{path:'conflict',method:'POST',body:{}}),/资料已变化/);
  await assert.rejects(request('externalHome',{path:'broken',method:'GET'}),/有效结果/);
  await assert.rejects(request('externalHome',{path:'redirect',method:'GET'}),/连接中断/);
  enabled=false;await assert.rejects(request('externalHome',{path:'state',method:'GET'}),/已停用/);
  await request('externalHome',{closeWorkspace:true});assert.deepEqual(killed,{pid:12345,signal:'SIGUSR1'});
  context.process.env.TRILIUM_WORKBENCH_BINDINGS=JSON.stringify({synthetic:{...binding,origin:'https://example.invalid'}});
  enabled=true;await assert.rejects(request('externalHome',{path:'state',method:'GET'}),/本机服务/);
  console.log('PASS: loopback-only routes, frame-note scope, 3MiB transport, business errors and owned-launcher exit.');
 }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
