export interface Track { id: string; title: string; artist: string; number: number; disc: number; duration: string; available: boolean; }
export interface Album { id: string; url: string; title: string; artist: string; year: string; cover: string; coverPreview?:string; tracks: Track[]; compilation: boolean; }
export type JobStatus = 'queued'|'running'|'done'|'partial'|'failed'|'cancelled'|'interrupted';
export interface Job { id:string; album:Album; root:string; bitrate:number; status:JobStatus; progress:number; message:string; path?:string; errors?:string[]; created:string; }
export interface Settings { root:string; bitrate:number; useYouTubeLogin?:boolean; }
export interface LibraryAlbum { title:string; artist:string; path:string; count:number; cover:string; }
export interface State { settings:Settings; jobs:Job[]; browser:{url:string;title:string;loading:boolean;error:string}; }
export interface API {
  state():Promise<State>;
  navigate(action:'home'|'back'|'forward'|'reload'|'search',query?:string):Promise<void>;
  browserVisible(visible:boolean):Promise<void>;
  inspect():Promise<Album>;
  enqueue(album:Album):Promise<void>;
  cancel(id:string):Promise<void>;
  retry(id:string):Promise<void>;
  folder():Promise<string>;
  bitrate(value:number):Promise<void>;
  youtubeLogin(value:boolean):Promise<void>;
  library():Promise<LibraryAlbum[]>;
  open(path:string):Promise<void>;
  onState(listener:(state:State)=>void):()=>void;
}
declare global { interface Window { dock:API; } }
