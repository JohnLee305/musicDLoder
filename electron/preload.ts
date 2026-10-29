import {contextBridge,ipcRenderer} from 'electron';
import type {API} from '../src/types';
const call=(name:string,...args:unknown[])=>ipcRenderer.invoke('dock:'+name,...args);
const api:API={state:()=>call('state'),navigate:(...a)=>call('navigate',...a),browserVisible:v=>call('visible',v),inspect:()=>call('inspect'),enqueue:a=>call('enqueue',a),cancel:id=>call('cancel',id),retry:id=>call('retry',id),folder:()=>call('folder'),bitrate:v=>call('bitrate',v),youtubeLogin:v=>call('youtubeLogin',v),library:()=>call('library'),open:p=>call('open',p),onState:listener=>{const fn=(_:unknown,s:any)=>listener(s);ipcRenderer.on('dock:state',fn);return()=>ipcRenderer.removeListener('dock:state',fn);}};
contextBridge.exposeInMainWorld('dock',api);
