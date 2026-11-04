const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const version=require('../package.json').version;
const arch=process.env.ALBUM_DOCK_ARCH||process.arch;
if(process.platform!=='darwin'||arch!==process.arch)throw Error('Build the DMG on a native macOS runner for the target CPU');
const bundle=path.resolve(`release/Album Dock-darwin-${arch}/Album Dock.app`);
require('./verify-bundle.cjs')(bundle,arch);
const target=path.resolve(`release/Album-Dock-${version}-macOS-${arch}.dmg`);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'album-dock-dmg-'));
try{
 const stage=path.join(temp,'Install');fs.mkdirSync(stage);
 execFileSync('/usr/bin/ditto',[bundle,path.join(stage,'Album Dock.app')]);
 fs.symlinkSync('/Applications',path.join(stage,'Applications'));
 fs.copyFileSync('docs/INSTALL.md',path.join(stage,'설치 안내.txt'));
 execFileSync('/usr/bin/hdiutil',['create','-volname','Album Dock '+version,'-srcfolder',stage,'-fs','HFS+','-format','UDZO','-ov',target],{stdio:'inherit'});
 execFileSync('/usr/bin/hdiutil',['verify',target],{stdio:'inherit'});
 const sum=crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
 fs.writeFileSync(target+'.sha256',sum+'  '+path.basename(target)+'\n');
 console.log(target);
}finally{fs.rmSync(temp,{recursive:true,force:true});}
