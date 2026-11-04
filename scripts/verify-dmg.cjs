const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {execFileSync}=require('node:child_process');
const dmg=process.argv[2];if(!dmg)throw Error('Pass a DMG path');
const mount=fs.mkdtempSync(path.join(os.tmpdir(),'Album Dock install test '));let attached=false;
try{
 execFileSync('/usr/bin/hdiutil',['attach',path.resolve(dmg),'-readonly','-nobrowse','-mountpoint',mount],{stdio:'inherit'});attached=true;
 if(fs.readlinkSync(path.join(mount,'Applications'))!=='/Applications')throw Error('Missing Applications shortcut');
 require('./verify-bundle.cjs')(path.join(mount,'Album Dock.app'));
}finally{if(attached)execFileSync('/usr/bin/hdiutil',['detach',mount],{stdio:'inherit'});fs.rmSync(mount,{recursive:true,force:true});}
