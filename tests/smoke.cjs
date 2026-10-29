const {_electron:electron}=require('playwright');
const path=require('node:path');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const testDir=process.env.ALBUM_DOCK_TEST_DIR;
if(!testDir)throw Error('Set ALBUM_DOCK_TEST_DIR to a scratch directory.');
fs.mkdirSync(testDir,{recursive:true});
(async()=>{
 const env={...process.env,ALBUM_DOCK_DATA:path.join(testDir,'data')};delete env.ELECTRON_RUN_AS_NODE;
 const desktop=await electron.launch({args:[root],env,timeout:60000});
 try{
  const page=await desktop.firstWindow();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.getByRole('button',{name:'내 음악',exact:true}).click();
  await page.locator('.album-card').first().waitFor({timeout:60000});
  const library=await page.evaluate(()=>window.dock.library());
  assert(library.length>0,'Existing music collection is readable');
  await page.screenshot({path:path.join(testDir,'library.png')});
  await page.getByRole('button',{name:'설정',exact:true}).click();
  await page.getByLabel('MP3 음질').selectOption('320');
  assert.equal((await page.evaluate(()=>window.dock.state())).settings.bitrate,320);
  await page.getByLabel('MP3 음질').selectOption('256');
  await page.screenshot({path:path.join(testDir,'settings.png')});
  await page.getByRole('button',{name:'다운로드함',exact:true}).click();
  await page.getByRole('heading',{name:'다음으로 소장할 앨범은?'}).waitFor();
  await page.getByRole('button',{name:'YT Music',exact:true}).click();
  const info=await desktop.evaluate(async({webContents})=>{
    const wc=webContents.getAllWebContents().find(w=>w.getURL().startsWith('https://music.youtube.com'));
    if(!wc)return {error:'YT Music page not found'};
    return {url:wc.getURL(),title:wc.getTitle(),node:await wc.executeJavaScript('typeof process'),body:(await wc.executeJavaScript('document.body.innerText')).slice(0,2500)};
  });
  assert.equal(info.node,'undefined','Remote page has no Node access');
  fs.writeFileSync(path.join(testDir,'report.json'),JSON.stringify({albums:library.length,tracks:library.reduce((n,a)=>n+a.count,0),rendererErrors:errors,browser:info},null,2));
  assert.equal(errors.length,0);
  console.log(JSON.stringify({albums:library.length,tracks:library.reduce((n,a)=>n+a.count,0),browser:info.title,rendererErrors:errors}));
 }finally{await desktop.close();}
})().catch(e=>{console.error(e);process.exit(1);});
