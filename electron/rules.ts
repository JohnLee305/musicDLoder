import type {Album} from '../src/types';
export function browserURL(raw:string) {
  try {
    const url=new URL(raw);
    if(url.protocol!=='https:'||url.username||url.password||url.port)return false;
    const hosts=['music.youtube.com','www.youtube.com','youtube.com','accounts.youtube.com','accounts.google.com','consent.youtube.com','consent.google.com'];
    return hosts.includes(url.hostname)||(url.hostname==='www.google.com'&&url.pathname.startsWith('/accounts/'));
  } catch {return false;}
}
export function albumPage(raw:string) {
  try {const u=new URL(raw);return u.hostname==='music.youtube.com' && (u.pathname.startsWith('/browse/MPRE') || (u.searchParams.get('list')||'').startsWith('OLAK5uy_'));}catch{return false;}
}
export function validateAlbum(input:any):Album {
  const str=(s:any,max=300)=>typeof s==='string'&&s.trim().length>0&&s.length<=max;
  if(!input || !str(input.id,100) || !/^MPRE[A-Za-z0-9_-]+$/.test(input.id) || !str(input.title) || !str(input.artist))throw Error('앨범 이름과 아티스트를 확인해 주세요.');
  if(!albumPage(input.url)||!Array.isArray(input.tracks)||!input.tracks.length||input.tracks.length>500)throw Error('잘못된 앨범 정보입니다.');
  const used=new Set<string>();
  for(const t of input.tracks){
    if(!str(t.title)||!str(t.artist)||!Number.isInteger(t.number)||t.number<1||t.number>999||!Number.isInteger(t.disc)||t.disc<1||t.disc>99||typeof t.available!=='boolean'||(t.available&&!/^[\w-]{11}$/.test(t.id)))throw Error('수록곡 정보를 확인해 주세요.');
    const key=t.disc+':'+t.number;if(used.has(key))throw Error('트랙 번호가 중복됐습니다.');used.add(key);
  }
  if(typeof input.cover!=='string'||input.cover.length>3000||typeof input.year!=='string'||!/^\d{0,4}$/.test(input.year))throw Error('커버 또는 발매 연도를 확인해 주세요.');
  return JSON.parse(JSON.stringify(input));
}

export function youtubeVideoId(raw:string):string {
  try {
    const u=new URL(raw.trim());
    if(u.protocol!=='https:'||u.username||u.password||u.port)throw Error();
    let id='';
    if(u.hostname==='youtu.be'&&/^\/[\w-]{11}$/.test(u.pathname))id=u.pathname.slice(1);
    if(['www.youtube.com','youtube.com','m.youtube.com','music.youtube.com'].includes(u.hostname)){
      if(u.pathname==='/watch')id=u.searchParams.get('v')||'';
      else if(/^\/(shorts|embed)\/[\w-]{11}$/.test(u.pathname))id=u.pathname.split('/')[2];
    }
    if(!/^[\w-]{11}$/.test(id))throw Error();
    return id;
  }catch{throw Error('https://www.youtube.com/watch?v=… 또는 https://youtu.be/… 형식의 영상 링크를 넣어 주세요.');}
}
