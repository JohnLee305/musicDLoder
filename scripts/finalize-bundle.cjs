const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

function finalize(bundle){
  const worker=path.resolve(bundle,'Contents/Resources/album-worker');
  const source=path.resolve(__dirname,'../resources/album-worker');
  function visit(dir){
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      const file=path.join(dir,entry.name);
      if(entry.isDirectory())visit(file);
      else if(entry.isSymbolicLink()){
        const original=fs.readlinkSync(file);
        if(path.isAbsolute(original)){
          const relative=path.relative(source,original);
          if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Unexpected external worker symlink: '+file);
          const replacement=path.join(worker,relative);
          if(!fs.existsSync(replacement))throw Error('Missing bundled worker dependency: '+replacement);
          fs.unlinkSync(file);
          fs.symlinkSync(path.relative(path.dirname(file),replacement),file);
        }
        const resolved=fs.realpathSync(file);
        if(!resolved.startsWith(worker+path.sep))throw Error('Worker dependency escapes app: '+file);
      }
    }
  }
  visit(worker);
  if(process.platform==='darwin'){
    execFileSync('/usr/bin/codesign',['--force','--deep','--sign','-',bundle],{stdio:'inherit'});
    execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',bundle],{stdio:'inherit'});
  }
}
module.exports=finalize;
if(require.main===module){if(!process.argv[2])throw Error('Pass the .app path');finalize(path.resolve(process.argv[2]));}
