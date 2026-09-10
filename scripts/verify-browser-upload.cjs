"use strict";
const {chromium}=require('playwright'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const base=process.env.QUICKSHARE_URL,state=JSON.parse(fs.readFileSync(process.env.QUICKSHARE_TEST_STATE));
(async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qs-browser-upload-'));
 const html='<!doctype html><h1>Browser upload verification</h1>',asset=Buffer.alloc(5*1024*1024,42);
 fs.writeFileSync(path.join(dir,'index.html'),html);fs.writeFileSync(path.join(dir,'large.txt'),asset);
 const grant=await fetch(base+'/api/v1/dashboard-link',{method:'POST',headers:{Authorization:'Bearer '+state.guest,'Content-Type':'application/json'},body:'{}'});assert.equal(grant.status,200);const {url}=await grant.json();
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{const page=await browser.newPage(),chunks=[];page.on('request',req=>{if(/\/uploads\/[^/]+\/chunks\//.test(req.url()))chunks.push(req.url());});
 await page.goto(url);await page.locator('#workspace').waitFor({state:'visible'});await page.locator('#folder-input').setInputFiles(dir);await page.locator('#publish-form [name=title]').fill('Browser upload verification');
 await page.locator('#publish-submit').click();await page.locator('#publish-success').waitFor({state:'visible',timeout:120000});assert.ok(chunks.length>1);
 const published=await page.locator('#published-url').textContent();const response=await fetch(published+'large.txt');assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),asset);
 assert.equal(await(await fetch(published)).text(),html);console.log('Real Chrome: authenticated 5 MiB folder upload used private chunks and preserved bytes.');
 }finally{await browser.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
