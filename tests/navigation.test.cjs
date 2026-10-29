const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const Module=require('node:module');
const path=require('node:path');
function compile(file){
  const filename=path.resolve(__dirname,'../electron',file);
  const out=buildSync({entryPoints:[filename],bundle:true,platform:'node',format:'cjs',write:false});
  const module=new Module(filename);module._compile(out.outputFiles[0].text,filename);return module.exports;
}
const {browserURL}=compile('rules.ts');
const {loadBrowserURL,blockedNavigationMessage}=compile('navigation.ts');

test('YT Music, Premium, Google sign-in and YouTube session redirects stay in the app',()=>{
  for(const url of ['https://music.youtube.com/','https://www.youtube.com/musicpremium','https://youtube.com/musicpremium','https://accounts.google.com/v3/signin/identifier','https://accounts.youtube.com/accounts/SetSID','https://www.google.com/accounts/SetSID','https://consent.youtube.com/m'])assert.equal(browserURL(url),true,url);
});
test('lookalike hosts, external URLs, credentials, custom ports and non-HTTPS stay blocked',()=>{
  for(const url of ['https://www.youtube.com.evil.test/musicpremium','https://accounts.google.com.evil.test/','https://example.com/','http://www.youtube.com/','file:///tmp/index.html','javascript:alert(1)','https://user:pass@www.youtube.com/','https://www.youtube.com:444/','https://www.google.com/search?q=anything'])assert.equal(browserURL(url),false,url);
});
test('Premium page reaches loadURL instead of being rejected by the app',async()=>{
  const calls=[];const contents={loadURL:async url=>{calls.push(url);}};
  assert.equal(await loadBrowserURL(contents,'https://www.youtube.com/musicpremium'),true);
  assert.deepEqual(calls,['https://www.youtube.com/musicpremium']);
});
test('a superseded navigation does not reject the IPC call',async()=>{
  for(const error of [Object.assign(new Error('aborted'),{code:'ERR_ABORTED'}),Object.assign(new Error('aborted'),{errno:-3})]){
    assert.equal(await loadBrowserURL({loadURL:async()=>{throw error;}},'https://music.youtube.com/'),false);
  }
});
test('DNS, certificate and other genuine failures are not swallowed',async()=>{
  for(const code of ['ERR_NAME_NOT_RESOLVED','ERR_CERT_AUTHORITY_INVALID','ERR_FAILED']){
    const error=Object.assign(new Error(code),{code});
    await assert.rejects(loadBrowserURL({loadURL:async()=>{throw error;}},'https://music.youtube.com/'),e=>e===error);
  }
});
test('programmatic external navigation cannot bypass the host check',async()=>{
  let called=false;
  await assert.rejects(loadBrowserURL({loadURL:async()=>{called=true;}},'https://external.invalid/'));
  assert.equal(called,false);
});
test('blocked-page diagnostics do not include authentication query strings',()=>{
  const message=blockedNavigationMessage('https://external.invalid/callback?code=secret-value');
  assert(message.includes('external.invalid'));assert(!message.includes('secret-value'));assert(!message.includes('callback'));
});
