const esbuild = require('esbuild');
const fs = require('node:fs');
(async () => {
  fs.mkdirSync('dist', {recursive:true});
  await esbuild.build({entryPoints:['src/app.tsx'],bundle:true,outfile:'dist/app.js',platform:'browser',target:'chrome130',jsx:'automatic',minify:true});
  await esbuild.build({entryPoints:['electron/main.ts'],bundle:true,outfile:'dist/main.cjs',platform:'node',target:'node22',external:['electron','node:sqlite']});
  await esbuild.build({entryPoints:['electron/preload.ts'],bundle:true,outfile:'dist/preload.cjs',platform:'node',target:'node22',external:['electron']});
  fs.copyFileSync('src/index.html','dist/index.html');
})();
