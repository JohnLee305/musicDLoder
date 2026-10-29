import {browserURL} from './rules';

export function abortedNavigation(error:unknown):boolean {
  if(!error||typeof error!=='object')return false;
  const failure=error as {code?:unknown;errno?:unknown};
  return failure.code==='ERR_ABORTED'||failure.errno===-3;
}

// Electron rejects loadURL when another navigation supersedes it. This is not
// a network/login failure. All other errors must remain visible to the caller.
export async function loadBrowserURL(contents:{loadURL:(url:string)=>Promise<void>},url:string):Promise<boolean>{
  if(!browserURL(url))throw Error('이 주소는 앱 안에서 열 수 없습니다. YT Music 홈으로 돌아가 주세요.');
  try{await contents.loadURL(url);return true;}
  catch(error){if(abortedNavigation(error))return false;throw error;}
}

export function blockedNavigationMessage(url:string):string{
  let host='알 수 없는 주소';
  try{host=new URL(url).hostname||host;}catch{}
  // Never display or persist authentication query strings.
  return `앱에서 ${host} 페이지 이동을 차단했습니다. YT Music 홈으로 돌아가 주세요.`;
}
