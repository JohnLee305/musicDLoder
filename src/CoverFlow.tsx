import React,{useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,Disc3,FolderOpen} from 'lucide-react';
import type {LibraryAlbum} from './types';

function Cover({album}:{album:LibraryAlbum}){
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[album.cover]);
  return album.cover&&!failed?<img src={album.cover} alt="" draggable={false} onError={()=>setFailed(true)}/>:<Disc3 size={70}/>;
}
export function CoverFlow({albums,open}:{albums:LibraryAlbum[];open:(path:string)=>void}){
  const [selected,setSelected]=useState('');
  const stage=useRef<HTMLDivElement>(null);
  const index=Math.max(0,albums.findIndex(a=>a.path===selected));
  const current=albums[index];
  const select=(i:number)=>setSelected(albums[Math.max(0,Math.min(albums.length-1,i))]?.path||'');
  useEffect(()=>{
    const el=stage.current;if(!el)return;
    let total=0,last=0;
    const wheel=(e:WheelEvent)=>{
      if(e.ctrlKey)return;
      e.preventDefault();
      const now=performance.now();
      if(now-last<130)return;
      const delta=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY;
      if(total&&Math.sign(total)!==Math.sign(delta))total=0;
      total+=delta*(e.deltaMode===1?16:e.deltaMode===2?300:1);
      if(Math.abs(total)<35)return;
      const direction=Math.sign(total);total=0;last=now;
      setSelected(old=>{const i=Math.max(0,albums.findIndex(a=>a.path===old));return albums[Math.max(0,Math.min(albums.length-1,i+direction))]?.path||'';});
    };
    el.addEventListener('wheel',wheel,{passive:false});
    return()=>el.removeEventListener('wheel',wheel);
  },[albums]);
  if(!current)return null;
  return <div className="coverflow">
    <div className="flow-stage" ref={stage} tabIndex={0} role="region" aria-label="앨범 커버플로우. 좌우 방향키로 이동" onKeyDown={e=>{
      if(e.target!==e.currentTarget)return;
      if(['ArrowLeft','ArrowRight','Home','End','Enter'].includes(e.key))e.preventDefault();
      if(e.key==='ArrowLeft')select(index-1);
      if(e.key==='ArrowRight')select(index+1);
      if(e.key==='Home')select(0);
      if(e.key==='End')select(albums.length-1);
      if(e.key==='Enter')open(current.path);
    }}>
      <div className="flow-glow"/>
      {albums.map((album,i)=>{
        const offset=i-index,distance=Math.abs(offset);if(distance>5)return null;
        const x=offset===0?0:Math.sign(offset)*(180+(distance-1)*84);
        return <button key={album.path} className={'flow-cover '+(offset===0?'is-current':'')} tabIndex={-1} aria-label={`${album.title} · ${album.artist}`} aria-pressed={offset===0} style={{transform:`translate(-50%, -50%) translateX(${x}px) translateZ(${-distance*65}px) rotateY(${offset===0?0:offset<0?58:-58}deg)`,zIndex:10-distance,opacity:distance>3?.35:1}} onClick={()=>{select(i);stage.current?.focus();}} onDoubleClick={()=>open(album.path)}>
          <div className="flow-face"><Cover album={album}/></div>
          <div className="flow-reflection" aria-hidden="true"><Cover album={album}/></div>
        </button>;
      })}
    </div>
    <div className="flow-caption" aria-live="polite" aria-atomic="true"><span className="eyebrow">{String(index+1).padStart(2,'0')} / {albums.length} ALBUMS</span><h2>{current.title}</h2><p>{current.artist} <span>·</span> {current.count}곡</p></div>
    <div className="flow-controls"><button className="icon-button" aria-label="이전 앨범" disabled={index===0} onClick={()=>select(index-1)}><ArrowLeft size={18}/></button><input type="range" aria-label="앨범 선택" min={0} max={Math.max(0,albums.length-1)} value={index} disabled={albums.length<2} onChange={e=>select(Number(e.target.value))}/><button className="icon-button" aria-label="다음 앨범" disabled={index===albums.length-1} onClick={()=>select(index+1)}><ArrowRight size={18}/></button></div>
    <div className="flow-bottom"><span>스크롤하거나 ← → 키로 넘겨보세요</span><button className="secondary" onClick={()=>open(current.path)}><FolderOpen size={15}/>앨범 폴더 열기</button></div>
  </div>;
}
