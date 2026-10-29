import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowLeft,ArrowRight,ArrowDownToLine,Music2,Disc3,Search,Settings2,RefreshCw,FolderOpen,Check,Plus,X,LoaderCircle,AlertCircle,Library,Headphones,ChevronRight,Home} from 'lucide-react';
import type {Album,Job,LibraryAlbum,State} from './types';
import './style.css';
import {CoverFlow} from './CoverFlow';

const labels:Record<Job['status'],string>={queued:'대기 중',running:'저장 중',done:'완료',partial:'일부 미완료',failed:'확인 필요',cancelled:'취소됨',interrupted:'중단됨'};
function Artwork({src,title,className=''}:{src:string;title:string;className?:string}){const [failed,setFailed]=useState(false);return <div className={'artwork '+className}>{src&&!failed?<img src={src} alt={title+' 커버'} onError={()=>setFailed(true)}/>:<Disc3 size={44}/>}</div>;}

function App(){
  const [state,setState]=useState<State>();
  const [tab,setTab]=useState<'browse'|'queue'|'library'|'settings'>('browse');
  const [search,setSearch]=useState('');
  const [album,setAlbum]=useState<Album|null>(null);
  const [busy,setBusy]=useState(false);
  const [toast,setToast]=useState('');
  const [error,setError]=useState('');
  const [library,setLibrary]=useState<LibraryAlbum[]>([]);
  const [libraryBusy,setLibraryBusy]=useState(false);
  const [filter,setFilter]=useState('');
  const [libraryView,setLibraryView]=useState<'flow'|'grid'>(()=>{try{return localStorage.getItem('libraryView')==='grid'?'grid':'flow';}catch{return 'flow';}});
  useEffect(()=>{try{localStorage.setItem('libraryView',libraryView);}catch{}},[libraryView]);
  const [details,setDetails]=useState<string|null>(null);
  const notify=(message:string)=>{setToast(message);setTimeout(()=>setToast(''),4500);};
  const run=async(fn:()=>Promise<unknown>)=>{try{await fn();}catch(e){setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''));}};
  useEffect(()=>{window.dock.state().then(setState).catch(e=>setError(String(e)));return window.dock.onState(setState);},[]);
  useEffect(()=>{void window.dock.browserVisible(tab==='browse'&&!album&&!busy&&!error);},[tab,album,busy,error]);
  const refreshLibrary=async()=>{setLibraryBusy(true);try{setLibrary(await window.dock.library());}finally{setLibraryBusy(false);}};
  useEffect(()=>{if(tab==='library')void run(refreshLibrary);},[tab,state?.settings.root]);
  const inspect=async()=>{setBusy(true);try{setAlbum(await window.dock.inspect());}catch(e){setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''));}finally{setBusy(false);}};
  const submit=async()=>{if(!album)return;await run(async()=>{await window.dock.enqueue(album);setAlbum(null);notify('앨범을 담았어요. 다운로드함에서 진행 상황을 확인하세요.');setTab('queue');});};
  if(!state)return <div className="boot"><Disc3 className="spin"/><p>Album Dock을 여는 중</p>{error&&<p>{error}</p>}</div>;
  const active=state.jobs.filter(j=>['queued','running'].includes(j.status)).length;
  const canAdd=/\/browse\/MPRE|[?&]list=OLAK5uy_/.test(state.browser.url);
  const filtered=library.filter(a=>(a.title+' '+a.artist).normalize('NFC').toLowerCase().includes(filter.normalize('NFC').toLowerCase()));
  const page={browse:['음악 둘러보기','듣다가 마음에 드는 앨범을 담아보세요.'],queue:['다운로드함','한 장씩, 내 아이팟을 위한 음악으로.'],library:['내 음악','커버로 펼쳐보는 나의 앨범 컬렉션.'],settings:['설정','내 음악이 머무를 곳과 저장 방식을 정해요.']}[tab];
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><Disc3 size={26}/></div><div>Album Dock<span>YOUR MUSIC, TO KEEP.</span></div></div>
      <div className="nav-label">WORKSPACE</div>
      <nav>
        <button className={tab==='browse'?'selected':''} onClick={()=>setTab('browse')}><Headphones size={18}/>YT Music</button>
        <button className={tab==='queue'?'selected':''} onClick={()=>setTab('queue')}><ArrowDownToLine size={18}/>다운로드함{active>0&&<b className="badge">{active}</b>}</button>
        <button className={tab==='library'?'selected':''} onClick={()=>setTab('library')}><Library size={18}/>내 음악</button>
      </nav>
      <div className="device"><div className="ipod"><div className="ipod-screen"><Music2 size={17}/></div><div className="wheel"><span/></div></div><div><span className="eyebrow">OUTPUT PROFILE</span><strong>iPod classic</strong><small>2007 · MP3 {state.settings.bitrate}k</small></div></div>
      <div className="sidebar-bottom"><button className={tab==='settings'?'selected':''} onClick={()=>setTab('settings')}><Settings2 size={17}/>설정</button><div className="version"><span className="dot"/> LOCAL COLLECTION <span>v0.1.4</span></div></div>
    </aside>
    <main>
      <header><div><span className="eyebrow">ALBUM DOCK / {tab.toUpperCase()}</span><h1>{page[0]}</h1></div><div className="header-actions">{tab==='browse'?<button className="primary" disabled={!canAdd||busy} onClick={inspect}><Plus size={17}/>이 앨범 담기</button>:<span className="profile-pill"><Disc3 size={15}/> iPod classic</span>}</div></header>
      {tab==='browse'?<>
        <div className="browser-toolbar"><div className="navigation"><button title="뒤로" onClick={()=>run(()=>window.dock.navigate('back'))}><ArrowLeft size={16}/></button><button title="앞으로" onClick={()=>run(()=>window.dock.navigate('forward'))}><ArrowRight size={16}/></button><button title="새로고침" onClick={()=>run(()=>window.dock.navigate('reload'))}><RefreshCw size={15} className={state.browser.loading?'spin':''}/></button><button title="YT Music 홈" onClick={()=>run(()=>window.dock.navigate('home'))}><Home size={15}/></button></div><form onSubmit={e=>{e.preventDefault();void run(()=>window.dock.navigate('search',search));}}><Search size={15}/><input aria-label="YT Music 검색" placeholder="YT Music에서 앨범, 아티스트 검색" value={search} onChange={e=>setSearch(e.target.value)}/><kbd>↵</kbd></form></div>
        <div className="browser-space"><Headphones size={32}/><p>{busy?'앨범 커버와 수록곡을 불러오는 중…':'YouTube Music'}</p>{state.browser.error&&<p>{state.browser.error}</p>}</div>
        <footer><span className="dot"/><span>{state.browser.error|| (state.browser.loading?'YT Music에 연결하는 중…':canAdd?'앨범을 찾았어요. 오른쪽 위에서 담을 수 있어요.':'앨범 상세 페이지를 열면 ‘이 앨범 담기’가 활성화돼요.')}</span><span>MP3 + COVER ART</span></footer>
      </>:tab==='queue'?<section className="content">
        <div className="section-heading"><div><p>{page[1]}</p><div className="count-line"><strong>{state.jobs.length}</strong>장의 앨범 <span>·</span> {active}개 진행 중</div></div><button className="secondary" onClick={()=>setTab('browse')}><Plus size={16}/>앨범 찾기</button></div>
        {!state.jobs.length?<div className="empty"><div className="empty-record"><Disc3 size={72}/></div><h2>다음으로 소장할 앨범은?</h2><p>YT Music에서 앨범을 열고 ‘이 앨범 담기’를 눌러보세요.<br/>커버와 수록곡을 확인한 뒤 MP3로 저장해요.</p><button className="primary" onClick={()=>setTab('browse')}>음악 둘러보기<ArrowRight size={16}/></button></div>:<div className="jobs">{state.jobs.map(j=><article className="job" key={j.id}><Artwork src={j.album.coverPreview||j.album.cover} title={j.album.title}/><div className="job-body"><div className="job-title"><h3>{j.album.title}</h3><span className={'status '+j.status}>{j.status==='done'&&<Check size={12}/>} {labels[j.status]}</span></div><p>{j.album.artist} <span>·</span> {j.album.tracks.length}곡 <span>·</span> MP3 {j.bitrate}k</p><div className="progress"><span style={{width:`${j.progress*100}%`}}/></div><small>{j.message}</small>{details===j.id&&<div className="errors">{j.errors?.map((s,i)=><p key={i}>{s}</p>)}</div>}</div><div className="job-actions">{['running','queued'].includes(j.status)?<button className="icon-button" title="작업 취소" onClick={()=>run(()=>window.dock.cancel(j.id))}><X size={17}/></button>:j.status!=='done'&&<button className="secondary" onClick={()=>run(()=>window.dock.retry(j.id))}><RefreshCw size={14}/>재시도</button>}{j.path&&<button title="앨범 폴더 열기" className="icon-button" onClick={()=>run(()=>window.dock.open(j.path!))}><FolderOpen size={18}/></button>}{!!j.errors?.length&&<button className="text-button" onClick={()=>setDetails(details===j.id?null:j.id)}>오류 보기</button>}</div></article>)}</div>}
      </section>:tab==='library'?<section className="content">
        <div className="section-heading"><div><p>{page[1]}</p><div className="count-line"><strong>{library.length}</strong>장의 앨범 <span>·</span> {library.reduce((s,a)=>s+a.count,0)}곡</div></div><div className="library-actions"><div className="view-switch" aria-label="앨범 보기 방식"><button aria-pressed={libraryView==='flow'} onClick={()=>setLibraryView('flow')}>커버플로우</button><button aria-pressed={libraryView==='grid'} onClick={()=>setLibraryView('grid')}>격자</button></div><div className="filter"><Search size={15}/><input placeholder="내 앨범 검색" value={filter} onChange={e=>setFilter(e.target.value)}/></div><button className="icon-button" title="컬렉션 새로고침" disabled={libraryBusy} onClick={()=>run(refreshLibrary)}><RefreshCw size={17} className={libraryBusy?'spin':''}/></button></div></div>
        {libraryBusy?<div className="empty"><LoaderCircle className="spin" size={32}/><p>음악 폴더에서 앨범을 읽는 중…</p></div>:filtered.length?libraryView==='flow'?<CoverFlow albums={filtered} open={p=>void run(()=>window.dock.open(p))}/>:<div className="album-grid">{filtered.map(a=><button className="album-card" key={a.path} onClick={()=>run(()=>window.dock.open(a.path))}><Artwork src={a.cover} title={a.title}/><h3>{a.title}</h3><p>{a.artist}</p><small>{a.count} TRACKS <FolderOpen size={12}/></small></button>)}</div>:<div className="empty"><Library size={50}/><h2>{filter?'검색 결과가 없어요':'앨범이 머무를 자리'}</h2><p>설정한 폴더의 ‘가수 / 앨범’ 구조를 읽어 보여줘요.</p><button className="secondary" onClick={()=>setTab('settings')}>음악 폴더 설정<ChevronRight size={16}/></button></div>}
      </section>:<section className="content settings">
        <p>{page[1]}</p><div className="setting-card"><div className="setting-icon"><FolderOpen size={23}/></div><div><h2>음악 저장 폴더</h2><p>가수 / 앨범 폴더를 자동으로 만들어요.</p><code>{state.settings.root}</code></div><button className="secondary" onClick={()=>run(()=>window.dock.folder())}>변경</button></div>
        <div className="setting-card"><div className="setting-icon"><Headphones size={23}/></div><div><h2>MP3 음질</h2><p>아이팟에서 재생할 일반 MP3 파일로 저장해요.</p><small>높은 비트레이트로 변환해도 원본보다 음질이 좋아지지는 않아요.</small></div><select aria-label="MP3 음질" value={state.settings.bitrate} onChange={e=>run(()=>window.dock.bitrate(Number(e.target.value)))}><option value={192}>192 kbps</option><option value={256}>256 kbps</option><option value={320}>320 kbps</option></select></div>
        <div className="profile-card"><Disc3 size={38}/><div><span className="eyebrow">MADE FOR YOUR CLASSIC</span><h2>음악과 커버를 함께.</h2><p>ID3v2.3 · JPEG 커버 최대 600px · 앨범 아티스트 · 트랙 번호</p><p>기존 파일은 덮어쓰지 않아요. 아이팟에 넣는 동기화는 별도로 진행해 주세요.</p></div></div>
        <div className="setting-card"><div className="setting-icon"><Headphones size={23}/></div><div><h2>YouTube 로그인을 다운로드에도 사용</h2><p>앱 안에서 로그인한 계정으로 접근 가능한 곡을 요청해요.</p><small>다음 작업·재시도부터 적용됩니다. 인증 정보는 다운로드 작업의 메모리에만 전달하며 별도 파일로 저장하지 않아요. 계정 이용 제한이 발생할 수 있으므로 필요한 경우에만 켜주세요.</small></div><input type="checkbox" aria-label="YouTube 로그인을 다운로드에도 사용" checked={state.settings.useYouTubeLogin===true} onChange={e=>run(()=>window.dock.youtubeLogin(e.target.checked))}/></div>
        <div className="setting-card"><div className="setting-icon"><Disc3 size={23}/></div><div><h2>Album Dock</h2><p>만든 사람: 찌모킹</p></div></div>
        <p className="settings-note">YT Music 로그인은 Google의 내장 브라우저 정책에 따라 제한될 수 있어요. 다운로드 가능 여부도 서비스 상태에 따라 달라집니다.</p>
      </section>}
    </main>
    {album&&<div className="overlay"><div className="modal"><div className="modal-head"><span className="eyebrow">ADD TO YOUR COLLECTION</span><button className="icon-button" title="닫기" onClick={()=>setAlbum(null)}><X size={20}/></button></div><div className="album-summary"><Artwork src={album.coverPreview||album.cover} title={album.title}/><div><label>앨범명<input value={album.title} onChange={e=>setAlbum({...album,title:e.target.value})}/></label><label>앨범 아티스트<input value={album.artist} onChange={e=>setAlbum({...album,artist:e.target.value})}/></label><div className="year-row"><label>발매 연도<input value={album.year} maxLength={4} onChange={e=>setAlbum({...album,year:e.target.value.replace(/\D/g,'')})}/></label><label className="checkbox"><input type="checkbox" checked={album.compilation} onChange={e=>setAlbum({...album,compilation:e.target.checked})}/>컴필레이션</label></div></div></div><div className="track-heading"><span>{album.tracks.length} TRACKS</span><span>수록 순서대로 저장</span></div><div className="track-list">{album.tracks.map((t,i)=><div className={'track '+(!t.available?'unavailable':'')} key={i}><span>{String(t.number).padStart(2,'0')}</span><div><strong>{t.title}</strong><small>{t.artist}</small></div><span>{t.available?t.duration:'이용 불가'}</span></div>)}</div><div className="modal-foot"><div><strong>MP3 {state.settings.bitrate}k + 앨범 커버</strong><small>{state.settings.root}</small></div><button className="primary" disabled={!album.tracks.some(t=>t.available)} onClick={submit}><ArrowDownToLine size={17}/>앨범 저장</button></div></div></div>}
    {busy&&<div className="overlay"><div className="loading-box"><LoaderCircle className="spin" size={32}/><h3>앨범을 준비하고 있어요</h3><p>커버와 수록곡 정보를 확인하는 중입니다.</p></div></div>}
    {error&&<div className="overlay error-overlay"><div className="error-box"><AlertCircle size={30}/><h2>확인이 필요해요</h2><p>{error}</p><button className="primary" onClick={()=>setError('')}>확인</button></div></div>}
    {toast&&<div className="toast"><Check size={17}/>{toast}</div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(window.dock?<App/>:<div className="boot"><Disc3 size={40}/><h1>Album Dock 앱으로 열어 주세요</h1><p>이 HTML 파일은 데스크톱 앱의 화면 소스입니다.</p><p>Finder에서 <strong>Album Dock.app</strong>을 실행하면 YT Music과 음악 폴더를 사용할 수 있어요.</p></div>);
