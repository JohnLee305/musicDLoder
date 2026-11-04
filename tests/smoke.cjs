// Run against a packaged app with a fresh profile and generated fixture library.
const {_electron:electron}=require('playwright');
const path=require('node:path');const fs=require('node:fs');const os=require('node:os');
const assert=require('node:assert/strict');const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const bundle=path.resolve(process.argv[2]||`release/Album Dock-darwin-${process.arch}/Album Dock.app`);
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'Album Dock clean install '));
(async()=>{
 const music=path.join(scratch,'music');
 execFileSync(process.env.ALBUM_DOCK_FIXTURE_PYTHON||'python3',[path.join(__dirname,'make_fixture.py'),music]);
 const env={...process.env,PATH:'/usr/bin:/bin',ALBUM_DOCK_DATA:path.join(scratch,'data'),ALBUM_DOCK_OUTPUT:music};delete env.ELECTRON_RUN_AS_NODE;delete env.ALBUM_DOCK_PYTHON;
 const desktop=await electron.launch({executablePath:path.join(bundle,'Contents/MacOS/Album Dock'),env,timeout:60000});
 try{
  const page=await desktop.firstWindow();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.getByRole('button',{name:'내 음악',exact:true}).click();
  await page.locator('.flow-cover.is-current').waitFor({timeout:60000});
  const library=await page.evaluate(()=>window.dock.library());assert.equal(library.length,2);
  const first=await page.locator('.flow-caption h2').textContent();
  await page.getByRole('button',{name:'다음 앨범',exact:true}).click();assert.notEqual(await page.locator('.flow-caption h2').textContent(),first);
  await page.locator('.flow-stage').focus();await page.keyboard.press('Home');assert.equal(await page.locator('.flow-caption h2').textContent(),first);
  await page.getByRole('button',{name:'격자',exact:true}).click();assert.equal(await page.locator('.album-card').count(),2);
  await page.getByRole('button',{name:'설정',exact:true}).click();
  await page.getByLabel('MP3 음질',{exact:true}).selectOption('320');
  assert.equal((await page.evaluate(()=>window.dock.state())).settings.bitrate,320);
  assert.equal((await page.evaluate(()=>window.dock.state())).settings.useYouTubeLogin,false);
  await page.getByRole('button',{name:'다운로드함',exact:true}).click();
  await page.getByRole('heading',{name:'다음으로 소장할 앨범은?'}).waitFor();
  assert.equal(errors.length,0);console.log('Packaged app: clean profile, library IPC, Cover Flow and settings passed');
 }finally{await desktop.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>fs.rmSync(scratch,{recursive:true,force:true}));
