const fs=require('node:fs');
const path=require('node:path');
const {execFileSync,spawnSync}=require('node:child_process');
function verify(bundle,arch=process.arch){
 bundle=path.resolve(bundle);
 const scratch=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'album-audit-'));
 const probe=path.join(scratch,'binary');
 const native=arch==='arm64'?'arm64':'x86_64';
 const binaries=[path.join(bundle,'Contents/MacOS/Album Dock'),path.join(bundle,'Contents/Resources/album-worker/album-worker')];
 const worker=path.join(bundle,'Contents/Resources/album-worker');
 let nativeCount=0;
 function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
  const f=path.join(dir,e.name);
  if(e.isSymbolicLink()){const dest=fs.realpathSync(f);if(!dest.startsWith(bundle+path.sep))throw Error('External symlink: '+f);continue;}
  if(e.isDirectory()){walk(f);continue;}
  const fd=fs.openSync(f,'r');const b=Buffer.alloc(4);fs.readSync(fd,b,0,4,0);fs.closeSync(fd);
  if(!['cffaedfe','cefaedfe','feedfacf','feedface','cafebabe','bebafeca'].includes(b.toString('hex')))continue;
  nativeCount++;
  const arches=execFileSync('/usr/bin/lipo',['-archs',f],{encoding:'utf8'}).trim().split(/\s+/);
  if(!arches.includes(native))throw Error('Wrong CPU: '+f+' ('+arches+')');
  // Older otool treats parentheses in helper names as archive syntax.
  try{fs.linkSync(f,probe);}catch{fs.copyFileSync(f,probe);}
  let deps;try{deps=execFileSync('/usr/bin/otool',['-L',probe],{encoding:'utf8'}).split('\n').slice(1);}finally{fs.unlinkSync(probe);}
  for(const line of deps){const dep=line.trim().split(' (')[0];if(dep.startsWith('/')&&!dep.startsWith('/usr/lib/')&&!dep.startsWith('/System/Library/'))throw Error('External native dependency: '+dep+' in '+f);}
 }}
 try{walk(bundle);}finally{fs.rmSync(scratch,{recursive:true,force:true});}
 for(const f of binaries)if(!fs.existsSync(f))throw Error('Missing executable: '+f);
 execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',bundle],{stdio:'inherit'});
 const env={PATH:'/usr/bin:/bin',TMPDIR:process.env.TMPDIR||'/tmp',ELECTRON_RUN_AS_NODE:'1'};
 const result=spawnSync(binaries[1],[],{env,input:'{"command":"health"}\n',encoding:'utf8',timeout:60000});
 if(result.status!==0)throw Error('Standalone worker failed: '+result.stderr);
 const health=JSON.parse(result.stdout.trim().split('\n').at(-1));
 if(!health.result?.tls_verified)throw Error('Worker TLS validation unavailable');
 const node=spawnSync(binaries[0],['-e','console.log(process.arch)'],{env,encoding:'utf8',timeout:30000});
 if(node.status!==0||node.stdout.trim()!==arch)throw Error('Bundled JavaScript runtime failed: '+node.stderr);
 console.log(JSON.stringify({arch,nativeCount,worker:health.result,standalone:true}));
}
module.exports=verify;
if(require.main===module)verify(process.argv[2]||`release/Album Dock-darwin-${process.arch}/Album Dock.app`);
