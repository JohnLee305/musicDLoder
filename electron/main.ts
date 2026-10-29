import {app,BrowserWindow,WebContentsView,ipcMain,dialog,shell,protocol,net,Menu} from 'electron';
import {DatabaseSync} from 'node:sqlite';
import {spawn,ChildProcess} from 'node:child_process';
import {mkdirSync,existsSync,realpathSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import type {State,Album,Job,LibraryAlbum} from '../src/types';
import {browserURL,albumPage,validateAlbum} from './rules';
import {loadBrowserURL,blockedNavigationMessage} from './navigation';

protocol.registerSchemesAsPrivileged([{scheme:'dock',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
if(process.env.ALBUM_DOCK_DATA){mkdirSync(process.env.ALBUM_DOCK_DATA,{recursive:true});app.setPath('userData',process.env.ALBUM_DOCK_DATA);}
let win:BrowserWindow;
let browser:WebContentsView;
let db:DatabaseSync;
let state:State;
let visible=true;
let activeJob:string|null=null;
let quitting=false;
const children=new Set<ChildProcess>();
const jobChildren=new Map<string,ChildProcess>();
const openedPaths=new Set<string>();
const previews=new Map<string,Album>();
const appRoot=path.join(__dirname,'..');

function save(){db.prepare('INSERT OR REPLACE INTO app_state(id, value) VALUES (1, ?)').run(JSON.stringify({settings:state.settings,jobs:state.jobs}));}
let pushTimer:ReturnType<typeof setTimeout>|null=null;
function push(){if(pushTimer)return;pushTimer=setTimeout(()=>{pushTimer=null;if(win&&!win.isDestroyed())win.webContents.send('dock:state',state);},100);}
function update(){save();push();}
function bounds(){if(!win||!browser)return;const [width,height]=win.getContentSize();browser.setBounds({x:216,y:118,width:Math.max(100,width-216),height:Math.max(100,height-158)});browser.setVisible(visible);}

function stopChild(child:ChildProcess){try{if(child.pid)process.kill(-child.pid,'SIGTERM');}catch{child.kill('SIGTERM');}}
function worker(command:Record<string,unknown>,onProgress?:(p:any)=>void,jobId?:string):Promise<any>{
  const bundled=path.join(app.isPackaged?process.resourcesPath:path.join(appRoot,'resources'),'album-worker','album-worker');
  const developmentPython=process.env.ALBUM_DOCK_PYTHON;
  const executable=existsSync(bundled)?bundled:developmentPython;
  if(!executable)return Promise.reject(Error('음악 처리 도구가 없습니다. 앱을 다시 빌드해 주세요.'));
  const args=executable===bundled?[]:[path.join(appRoot,'worker','album_worker.py')];
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{detached:true,stdio:['pipe','pipe','pipe'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1',PYTHONUNBUFFERED:'1'}});
    children.add(child);if(jobId)jobChildren.set(jobId,child);
    let buffer='',error='',result:any,reported='';
    const timer=setTimeout(()=>{reported='작업 응답 시간이 초과됐습니다. 다시 시도해 주세요.';stopChild(child);},command.command==='download'?60*60*1000:90000);
    child.stdout!.on('data',data=>{buffer+=data.toString();let split;while((split=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,split);buffer=buffer.slice(split+1);try{const event=JSON.parse(line);if(event.type==='result')result=event.result;else if(event.type==='error')reported=event.message;else if(event.type==='progress')onProgress?.(event);}catch{}}});
    child.stderr!.on('data',data=>{error=(error+data.toString()).slice(-2000);});
    const cleanup=()=>{clearTimeout(timer);children.delete(child);if(jobId)jobChildren.delete(jobId);};
    child.on('error',e=>{cleanup();reject(e);});
    child.on('close',code=>{cleanup();if(code===0&&result!==undefined)resolve(result);else reject(Error(reported||error||'작업이 중단됐습니다.'));});
    child.stdin!.on('error',()=>{});
    child.stdin!.end(JSON.stringify({...command,node:process.execPath})+'\n');
  });
}

async function nextJob(){
  if(activeJob||quitting)return;
  const job=state.jobs.find(j=>j.status==='queued');if(!job)return;
  activeJob=job.id;job.status='running';job.message='다운로드 준비 중';update();
  try{
    const cookies=state.settings.useYouTubeLogin ? (await browser.webContents.session.cookies.get({domain:'youtube.com'})).filter(c=>{const d=(c.domain||'').replace(/^\./,'');return d==='youtube.com'||d.endsWith('.youtube.com');}) : [];
    if(job.status!=='running')return;
    const result=await worker({command:'download',album:job.album,root:job.root,bitrate:job.bitrate,cookies},p=>{if(job.status!=='running')return;job.progress=Math.max(0,Math.min(1,Number(p.progress)||0));job.message=String(p.message||'');push();},job.id);
    if(job.status==='running'){job.status=result.status;job.path=result.path;job.errors=result.errors;job.progress=1;job.message=result.status==='done'?'MP3와 앨범 커버 저장 완료':`${result.errors.length}곡을 확인해 주세요`;if(result.path)openedPaths.add(result.path);}
  }catch(e){if(job.status==='running'){job.status='failed';job.message=(e as Error).message;}}
  finally{activeJob=null;update();void nextJob();}
}

function register(){
  function handle(name:string,fn:(...args:any[])=>any){ipcMain.handle('dock:'+name,(event,...args)=>{if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||!event.senderFrame.url.startsWith('dock://app/'))throw Error('허용되지 않은 요청입니다.');return fn(...args);});}
  handle('state',()=>state);
  handle('visible',(value:boolean)=>{visible=value===true;bounds();});
  handle('navigate',async(action:string,query:string)=>{
    const wc=browser.webContents;
    if(action==='home')await loadBrowserURL(wc,'https://music.youtube.com/');
    else if(action==='reload')wc.reload();
    else if(action==='back'&&wc.navigationHistory.canGoBack())wc.navigationHistory.goBack();
    else if(action==='forward'&&wc.navigationHistory.canGoForward())wc.navigationHistory.goForward();
    else if(action==='search'&&typeof query==='string'&&query.trim())await loadBrowserURL(wc,'https://music.youtube.com/search?q='+encodeURIComponent(query.slice(0,300)));
  });
  handle('inspect',async()=>{const url=browser.webContents.getURL();if(!albumPage(url))throw Error('YT Music에서 앨범 상세 페이지를 열어 주세요.');const album=await worker({command:'inspect',url});previews.set(album.id,album);return album;});
  handle('enqueue',(input:Album)=>{
    const album=validateAlbum(input);const original=previews.get(album.id);
    if(!original||album.cover!==original.cover||album.tracks.length!==original.tracks.length||album.tracks.some((t,i)=>t.id!==original.tracks[i].id))throw Error('앨범을 다시 불러와 주세요.');
    if(state.jobs.some(j=>j.album.id===album.id&&j.root===state.settings.root&&['queued','running','done'].includes(j.status)))throw Error('이미 대기 중이거나 저장한 앨범입니다.');
    if(!album.tracks.some(t=>t.available))throw Error('현재 가져올 수 있는 곡이 없습니다. 서비스의 로그인 또는 이용 제한을 확인해 주세요.');
    state.jobs.push({id:randomUUID(),album,root:state.settings.root,bitrate:state.settings.bitrate,status:'queued',progress:0,message:'대기 중',created:new Date().toISOString()});update();void nextJob();
  });
  handle('cancel',(id:string)=>{const job=state.jobs.find(j=>j.id===id);if(!job||!['queued','running'].includes(job.status))return;job.status='cancelled';job.message='취소됨 · 저장된 곡은 유지됩니다';const child=jobChildren.get(id);if(child)stopChild(child);update();});
  handle('retry',(id:string)=>{const job=state.jobs.find(j=>j.id===id);if(!job||!['partial','failed','cancelled','interrupted'].includes(job.status))return;job.status='queued';job.progress=0;job.message='빠진 곡 다시 받기';job.errors=[];update();void nextJob();});
  handle('folder',async()=>{const result=await dialog.showOpenDialog(win,{title:'앨범을 저장할 음악 폴더',defaultPath:state.settings.root,properties:['openDirectory','createDirectory']});if(!result.canceled){state.settings.root=result.filePaths[0];update();}return state.settings.root;});
  handle('bitrate',(value:number)=>{if(![192,256,320].includes(value))throw Error('잘못된 설정');state.settings.bitrate=value;update();});
  handle('youtubeLogin',(value:boolean)=>{if(typeof value!=='boolean')throw Error('잘못된 설정');state.settings.useYouTubeLogin=value;update();});
  handle('library',async()=>{const albums:LibraryAlbum[]=await worker({command:'library',root:state.settings.root});for(const a of albums)openedPaths.add(a.path);return albums;});
  handle('open',async(folder:string)=>{if(!openedPaths.has(folder))throw Error('앱에서 확인한 앨범 폴더만 열 수 있습니다.');if(!existsSync(folder))throw Error('폴더가 없습니다.');const result=await shell.openPath(realpathSync(folder));if(result)throw Error(result);});
}

async function createWindow(){
  win=new BrowserWindow({width:1260,height:840,minWidth:1000,minHeight:700,title:'Album Dock',backgroundColor:'#111310',titleBarStyle:'hiddenInset',trafficLightPosition:{x:22,y:23},webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(e,url)=>{if(!url.startsWith('dock://app/'))e.preventDefault();});
  browser=new WebContentsView({webPreferences:{partition:'persist:ytmusic',nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  browser.setBackgroundColor('#030303');
  browser.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  browser.webContents.session.setPermissionCheckHandler(()=>false);
  const blocked=(url:string)=>{state.browser.error=blockedNavigationMessage(url);push();};
  browser.webContents.setWindowOpenHandler(({url})=>{
    if(browserURL(url))void loadBrowserURL(browser.webContents,url).catch(()=>{state.browser.error='페이지를 열지 못했습니다. 새로고침하거나 YT Music 홈으로 돌아가 주세요.';push();});
    else blocked(url);
    return {action:'deny'};
  });
  browser.webContents.on('will-navigate',(event,url)=>{if(!browserURL(url)){event.preventDefault();blocked(url);}});
  browser.webContents.on('will-redirect',(event,url,_inPlace,isMainFrame)=>{if(isMainFrame&&!browserURL(url)){event.preventDefault();blocked(url);}});
  const sync=()=>{state.browser.url=browser.webContents.getURL();state.browser.title=browser.webContents.getTitle();push();};
  browser.webContents.on('did-navigate',sync);browser.webContents.on('did-navigate-in-page',sync);browser.webContents.on('page-title-updated',sync);
  browser.webContents.on('did-start-loading',()=>{state.browser.loading=true;state.browser.error='';push();});
  browser.webContents.on('did-stop-loading',()=>{state.browser.loading=false;sync();});
  browser.webContents.on('did-fail-load',(_e,code,description,_url,main)=>{if(main&&code!==-3){state.browser.error='YT Music 연결 실패: '+description;push();}});
  win.contentView.addChildView(browser);bounds();
  win.on('resize',bounds);
  win.on('close',event=>{if(activeJob&&!quitting){const choice=dialog.showMessageBoxSync(win,{type:'question',buttons:['계속 받기','작업을 멈추고 닫기'],defaultId:0,cancelId:0,message:'앨범을 받고 있어요.',detail:'지금 닫아도 저장된 곡은 유지됩니다. 다음 실행에서 다시 시도할 수 있어요.'});if(choice===0){event.preventDefault();return;}}quitting=true;for(const child of children)stopChild(child);});
  win.on('closed',()=>{if(!browser.webContents.isDestroyed())browser.webContents.close();});
  await win.loadURL('dock://app/index.html');
  await loadBrowserURL(browser.webContents,'https://music.youtube.com/').catch(()=>{state.browser.error='YT Music에 연결하지 못했습니다. 새로고침해 주세요.';push();});
  if(process.env.ALBUM_DOCK_SMOKE){
    setTimeout(async()=>{
      const report={url:browser.webContents.getURL(),title:browser.webContents.getTitle(),error:state.browser.error,remoteNodeType:await browser.webContents.executeJavaScript('typeof process')};
      writeFileSync(path.join(process.env.ALBUM_DOCK_SMOKE!,'browser.json'),JSON.stringify(report,null,2));
      visible=false;bounds();
      win.webContents.send('dock:smoke');
      writeFileSync(path.join(process.env.ALBUM_DOCK_SMOKE!,'app.png'),(await win.webContents.capturePage()).toPNG());
      quitting=true;app.quit();
    },18000);
  }
}

app.whenReady().then(async()=>{
  protocol.handle('dock',request=>{const url=new URL(request.url);const name=url.pathname.slice(1);if(url.hostname!=='app'||!['index.html','app.js','app.css'].includes(name))return new Response('Not found',{status:404});return net.fetch(pathToFileURL(path.join(__dirname,name)).href);});
  mkdirSync(app.getPath('userData'),{recursive:true});
  db=new DatabaseSync(path.join(app.getPath('userData'),'library.sqlite'));
  db.exec('CREATE TABLE IF NOT EXISTS app_state(id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  let saved:any;try{const row=db.prepare('SELECT value FROM app_state WHERE id=1').get() as any;saved=row?JSON.parse(row.value):null;}catch{}
  state={settings:saved?.settings||{root:process.env.ALBUM_DOCK_OUTPUT||path.join(app.getPath('desktop'),'음악'),bitrate:256},jobs:saved?.jobs||[],browser:{url:'https://music.youtube.com/',title:'YouTube Music',loading:true,error:''}};
  state.settings.useYouTubeLogin=state.settings.useYouTubeLogin===true;
  for(const job of state.jobs){if(job.status==='running'){job.status='interrupted';job.message='지난 작업이 중단됐어요. 다시 시도하면 저장된 곡은 건너뜁니다.';}if(job.path)openedPaths.add(job.path);}
  save();Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Album Dock',submenu:[{role:'about'},{type:'separator'},{role:'quit'}]},{label:'편집',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'보기',submenu:[{role:'toggleDevTools'},{role:'togglefullscreen'}]}]));
  register();await createWindow();void nextJob();
}).catch(error=>{dialog.showErrorBox('Album Dock 시작 오류',String(error?.message||error));app.exit(1);});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{quitting=true;for(const child of children)stopChild(child);});
