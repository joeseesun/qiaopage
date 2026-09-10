"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict");
const {createServer}=require("node:http"),{randomBytes}=require("node:crypto");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{spawn}=require("node:child_process");
const {createApp}=require("../server");
const rootToken="agent-account-root-test-".repeat(3);
async function fixture(t){
 const server=createServer();await new Promise(r=>server.listen(0,"127.0.0.1",r));
 const url=`http://127.0.0.1:${server.address().port}`;
 const runtime=createApp({token:rootToken,dbPath:":memory:",baseUrl:url});server.on("request",runtime.app);
 t.after(()=>new Promise(r=>{server.close(()=>{runtime.db.close();r();});server.closeIdleConnections();}));
 const call=(p,body,method=body===undefined?"GET":"POST",token=rootToken,extra={})=>fetch(url+p,{method,headers:{"Content-Type":"application/json",Origin:url,...(token?{Authorization:"Bearer "+token}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
 const guest=async(label="Private administrator note")=>{const invite=await(await call("/api/v1/invites",{label})).json();const token=randomBytes(32).toString("hex");const result=await(await call("/auth/accept",{invite:invite.code,apiToken:token},"POST",null)).json();assert.equal(result.ok,true);const me=await(await call("/api/v1/me",undefined,"GET",token)).json();return{token,id:me.member.id};};
 const a=await guest(),b=await guest("Second private note");
 await call("/api/v1/works/owned",{title:"Own",html:"<h1>Exact source</h1>"},"PUT",a.token);
 await call("/api/v1/works/other",{title:"Other",html:"<h1>Other source</h1>"},"PUT",b.token);
 return{...runtime,server,url,call,a,b,guest};
}
test("live identity and capabilities expose own usage and role-filtered tools without secrets or private notes",async t=>{
 const {call,a}=await fixture(t);
 const me=await(await call("/api/v1/me",undefined,"GET",a.token)).json();
 assert.equal(me.account.id,a.id);assert.equal(me.account.role,"member");assert.equal(me.connection.kind,"agent_key");assert.equal(me.usage.sites,1);assert.equal(me.permissions.manageFriends,false);
 assert.equal(me.defaults.searchIndexable,false);assert.equal(me.account.registered,false);
 const skill=await(await call("/skill.md")).text();
 assert.ok(JSON.parse(skill.split("\n").find(line=>line.startsWith("description: ")).slice(13)).includes("Quickshare"));
 const caps=await(await call("/api/v1/capabilities",undefined,"GET",a.token)).json();
 assert.ok(caps.tools.some(x=>x.name==="account.update"&&x.scope==="self"));assert.ok(!caps.tools.some(x=>x.name.startsWith("friends.")));
 assert.equal(caps.tools.find(x=>x.name==="sharing.preview").mutates,false);
 for(const secret of [a.token,rootToken,"Private administrator note","api_hash","password_hash"]) assert.ok(!JSON.stringify(caps).includes(secret));
 const admin=await(await call("/api/v1/capabilities")).json();assert.ok(admin.tools.some(x=>x.name==="friends.recover"));assert.equal(admin.usage.sites,0);
 for(const p of ["/api/v1/me","/api/v1/account","/api/v1/capabilities"]) assert.equal((await call(p,undefined,"GET",null)).status,401);
});
test("self account rename supports registered members, protects stable ownership and rejects conflicts and foreign fields",async t=>{
 const {call,db,a,b}=await fixture(t);
 const before=db.prepare("SELECT * FROM works WHERE slug='owned'").get();
 let res=await call("/api/v1/account",{revision:0,username:"alice",password:"initial-password-123"},"PATCH",a.token);assert.equal(res.status,200);
 res=await call("/api/v1/account",{revision:1,username:"alice-renamed"},"PATCH",a.token);assert.equal(res.status,200);
 const data=await res.json();assert.equal(data.account.id,a.id);assert.equal(data.account.registered,true);assert.equal(data.effects.agentConnectionsPreserved,true);
 assert.deepEqual(db.prepare("SELECT * FROM works WHERE slug='owned'").get(),before);
 assert.equal((await call("/auth/login",{username:"alice-renamed",password:"initial-password-123"},"POST",null)).status,200);
 assert.equal((await call("/api/v1/account",{revision:0,username:"alice-renamed"},"PATCH",b.token)).status,409);
 for(const extra of [{id:b.id},{role:"admin"},{api_hash:"x"}]) assert.equal((await call("/api/v1/account",{revision:2,username:"alice",...extra},"PATCH",a.token)).status,400);
 assert.equal((await call("/api/v1/account",{revision:1,username:"stale"},"PATCH",a.token)).status,409);
 assert.equal((await call("/api/v1/account",{username:"missingrevision"},"PATCH",a.token)).status,400);
 const row=db.prepare("SELECT * FROM members WHERE id=?").get(a.id);assert.equal(row.username,"alice-renamed");assert.equal(row.note,"Private administrator note");
});
test("password changes revoke browser and pending grants while preserving current and other Agent connections",async t=>{
 const {call,db,a,b}=await fixture(t);
 await call("/api/v1/account",{revision:0,username:"alice",password:"old-password-1234"},"PATCH",a.token);
 const login=await call("/auth/login",{username:"alice",password:"old-password-1234"},"POST",null);const cookie=login.headers.get("set-cookie").split(";")[0];
 const grant=await(await call("/api/v1/dashboard-link",{},"POST",a.token)).json();
 await call("/api/v1/agent-grant",{},"POST",a.token);
 await call("/api/v1/agent-grant",{},"POST",b.token);
 assert.equal((await call("/api/v1/account",{revision:1,password:"new-password-1234"},"PATCH",null,{Cookie:cookie,Origin:"https://evil.example"})).status,403);
 const changed=await call("/api/v1/account",{revision:1,password:"new-password-1234"},"PATCH",null,{Cookie:cookie});assert.equal(changed.status,200);
 const renewed=changed.headers.get("set-cookie").split(";")[0];assert.notEqual(renewed,cookie);
 assert.equal((await call("/api/v1/me",undefined,"GET",null,{Cookie:cookie})).status,401);assert.equal((await call("/api/v1/me",undefined,"GET",null,{Cookie:renewed})).status,200);
 assert.equal((await call("/auth/grant",{code:new URL(grant.url).hash.slice(6)},"POST",null)).status,410);
 assert.equal(db.prepare("SELECT count(*) n FROM agent_grants WHERE member_id=?").get(a.id).n,0);assert.equal(db.prepare("SELECT count(*) n FROM agent_grants WHERE member_id=?").get(b.id).n,1);
 for(const member of[a,b]) assert.equal((await call("/api/v1/me",undefined,"GET",member.token)).status,200);
 assert.equal((await call("/auth/login",{username:"alice",password:"old-password-1234"},"POST",null)).status,401);
 assert.equal((await call("/auth/login",{username:"alice",password:"new-password-1234"},"POST",null)).status,200);
 const count=db.prepare("SELECT count(*) n FROM sessions").get().n;
 assert.equal((await(await call("/api/v1/account/verify-password",{password:"new-password-1234"},"POST",a.token)).json()).valid,true);
 assert.equal(db.prepare("SELECT count(*) n FROM sessions").get().n,count);
});
test("concurrent account writes and credentials revoked during password derivation cannot overwrite newer state",async t=>{
 const {call,db,a,server}=await fixture(t);
 const results=await Promise.all([call("/api/v1/account",{revision:0,password:"first-password-123"},"PATCH",a.token),call("/api/v1/account",{revision:0,username:"winner"},"PATCH",a.token)]);
 assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
 const revision=db.prepare("SELECT account_revision n FROM members WHERE id=?").get(a.id).n;
 server.prependListener("request", req=>{
  if(req.method==="PATCH" && req.url==="/api/v1/account") queueMicrotask(()=>db.prepare("DELETE FROM api_keys WHERE member_id=?").run(a.id));
 });
 const res=await call("/api/v1/account",{revision,password:"revoked-password-123"},"PATCH",a.token);
 assert.equal(res.status,401);
 assert.equal(db.prepare("SELECT account_revision n FROM members WHERE id=?").get(a.id).n,revision);
 assert.equal((await call("/api/v1/me",undefined,"GET",a.token)).status,401);
 assert.equal(db.isTransaction,false);
});
async function cliFixture(t,fixtureData){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"qs-agent-cli-"));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const cli=path.join(dir,"quickshare.js"),config=path.join(dir,"connection.json");
 fs.writeFileSync(cli,await(await fixtureData.call("/client/quickshare.js")).text());
 fs.writeFileSync(config,JSON.stringify({url:fixtureData.url,token:fixtureData.a.token}),{mode:0o600});
 const run=(args,input="",token)=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[cli,...args,"--json"],{cwd:dir,env:{...process.env,QUICKSHARE_CONFIG:config,QUICKSHARE_TOKEN:token||"",QUICKSHARE_URL:""}});
  let stdout="",stderr="";child.stdout.on("data",d=>stdout+=d);child.stderr.on("data",d=>stderr+=d);child.on("error",reject);child.on("close",code=>resolve({code,stdout,stderr,data:stdout?JSON.parse(stdout):null}));child.stdin.end(input);
 });return{dir,config,run};
}
test("portable CLI discovers permissions, changes own account, stores generated passwords privately and previews without saving",async t=>{
 const f=await fixture(t),{run,dir,config}=await cliFixture(t,f),originalConfig=fs.readFileSync(config,"utf8");
 const who=await run(["whoami"]);assert.equal(who.data.account.id,f.a.id);
 const cap=await run(["capabilities"]);assert.equal(cap.data.cliVersion,"1.4.0");
 const renamed=await run(["account","--username","agent-user"]);assert.equal(renamed.code,0,renamed.stderr);
 const file=path.join(dir,"password.txt"),generated=await run(["account","--generate-password","--output",file]);
 assert.equal(generated.code,0,generated.stderr);assert.equal(generated.data.passwordVerified,true);
 const password=fs.readFileSync(file,"utf8").trim();assert.ok(password.length>=24);assert.equal(fs.statSync(file).mode&0o777,0o600);
 assert.ok(!generated.stdout.includes(password)&&!generated.stderr.includes(password));
 assert.equal((await run(["account","--verify-password-stdin"],password+"\n")).data.valid,true);
 assert.equal((await run(["account","--generate-password","--output",file])).code,1);
 assert.equal(fs.readFileSync(config,"utf8"),originalConfig);
 const visibility=await run(["visibility","owned","--gallery","true"]);assert.equal(visibility.data.work.listed,true);assert.equal(visibility.data.work.search_indexable,0);
 const output=path.join(dir,"preview.png");const preview=await run(["sharing","owned","--preview","--share-enabled","true","--title","Card preview","--output",output]);assert.equal(preview.code,0,preview.stderr);
 assert.equal(fs.readFileSync(output).readUInt32BE(16),1200);assert.equal((await run(["sharing","owned"])).data.enabled,false);
 const forbidden=await run(["friends"]);assert.equal(forbidden.code,1);assert.equal(JSON.parse(forbidden.stderr).error.status,403);
 const bad=await run(["account","--password-stdin"],"short");assert.equal(bad.code,1);assert.ok(!bad.stderr.includes('"short"'));
});
test("administrator CLI friend tools remain permission-bound and write invitation and recovery secrets only to private files",async t=>{
 const f=await fixture(t),{run,dir}=await cliFixture(t,f);
 const invited=await run(["invite","CLI friend","--output",path.join(dir,"invite.json")],"",rootToken);assert.equal(invited.code,0,invited.stderr);
 const secret=JSON.parse(fs.readFileSync(invited.data.output));assert.ok(secret.code);assert.ok(!invited.stdout.includes(secret.code));assert.equal(fs.statSync(invited.data.output).mode&0o777,0o600);
 assert.equal((await run(["reinvite",secret.id,"--output",path.join(dir,"reinvite.json")],"",rootToken)).code,0);
 assert.equal((await run(["revoke-invite",secret.id],"",rootToken)).code,0);
 assert.equal((await run(["friend",String(f.a.id),"--note","Updated private note"],"",rootToken)).code,0);
 const friends=await run(["friends"],"",rootToken);assert.ok(friends.data.friends.some(x=>x.note==="Updated private note"));
 const recovered=await run(["recover",String(f.a.id),"--output",path.join(dir,"recover.json")],"",rootToken);assert.equal(recovered.code,0,recovered.stderr);
 assert.ok(!recovered.stdout.includes("本次连接码"));
 assert.equal((await run(["friend",String(f.a.id),"--disabled","true"],"",rootToken)).code,0);
 assert.equal((await run(["whoami"])).code,1);
});
test("a lost account response preserves the generated password for verification without a second mutation",async t=>{
 const f=await fixture(t),{run,dir}=await cliFixture(t,f);
 let dropped=false;
 const proxy=createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const body=Buffer.concat(chunks);
  const upstream=await fetch(f.url+req.url,{method:req.method,headers:{Authorization:req.headers.authorization,"Content-Type":"application/json"},...(body.length?{body}:{})});
  const text=await upstream.text();
  if(req.method==="PATCH"&&req.url==="/api/v1/account"&&!dropped){dropped=true;res.destroy();return;}
  res.writeHead(upstream.status,{"Content-Type":"application/json"});res.end(text);
 });
 await new Promise(r=>proxy.listen(0,"127.0.0.1",r));
 t.after(()=>new Promise(r=>{proxy.close(r);proxy.closeIdleConnections();}));
 const file=path.join(dir,"retained-password.txt");
 const lost=await run(["account","--generate-password","--output",file,"--url",`http://127.0.0.1:${proxy.address().port}`],"",f.a.token);
 assert.equal(lost.code,1);assert.equal(dropped,true);
 const password=fs.readFileSync(file,"utf8");assert.ok(!lost.stderr.includes(password.trim()));
 const checked=await run(["account","--verify-password-stdin"],password);assert.equal(checked.code,0,checked.stderr);assert.equal(checked.data.valid,true);
 assert.equal(f.db.prepare("SELECT account_revision n FROM members WHERE id=?").get(f.a.id).n,1);
});
