const {packager}=require('@electron/packager');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const zipDir=process.env.ALBUM_DOCK_ELECTRON_ZIP_DIR;
if(zipDir){
  const name=`electron-v${require('electron/package.json').version}-darwin-x64.zip`;
  const expected=require('electron/checksums.json')[name];
  const actual=crypto.createHash('sha256').update(fs.readFileSync(path.join(zipDir,name))).digest('hex');
  if(!expected||actual!==expected)throw Error('Electron archive checksum mismatch');
}
if(!fs.existsSync('resources/album-worker/album-worker'))throw Error('Build the Python worker first. See README.md.');
const {spawnSync}=require('node:child_process');
const health=spawnSync(path.resolve('resources/album-worker/album-worker'),[],{input:JSON.stringify({command:'health'})+'\n',encoding:'utf8'});
if(health.status!==0)throw Error('Packaged worker health failed: '+health.stderr+' '+health.stdout);
const report=health.stdout.trim().split('\n').map(line=>JSON.parse(line)).find(event=>event.type==='result');
if(!report?.result?.tls_verified)throw Error('Packaged worker TLS verification is unavailable');
packager({dir:'.',name:'Album Dock',platform:'darwin',arch:'x64',out:'release',overwrite:true,asar:true,electronZipDir:zipDir,download:{cacheRoot:process.env.ALBUM_DOCK_ELECTRON_CACHE||path.join(os.tmpdir(),'album-dock-electron-cache')},appBundleId:'local.albumdock.app',appCategoryType:'public.app-category.music',extraResource:['resources/album-worker'],ignore:[/^\/release/,/^\/resources/,/^\/worker/,/^\/tests/,/^\/scripts/,/^\/src/,/^\/electron/,/^\/README/,/^\/tsconfig/,/^\/node_modules/],prune:false}).then(paths=>{for(const p of paths)require('./finalize-bundle.cjs')(path.join(p,'Album Dock.app'));console.log(paths);}).catch(e=>{console.error(e);process.exit(1);});
