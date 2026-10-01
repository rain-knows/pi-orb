// Diagnostic evidence only. No crash uploads, no production setting or process recovery.
const { app, crashReporter } = require('electron');
const { mkdirSync } = require('node:fs');
const { join, resolve } = require('node:path');
const userData=process.argv.find(argument=>argument.startsWith('--user-data-dir='));
if(!userData)throw new Error('Crash probe requires isolated user-data-dir');
const dumps=join(userData.slice('--user-data-dir='.length),'crash-dumps');
mkdirSync(dumps,{recursive:true});
app.setPath('crashDumps',dumps);
crashReporter.start({uploadToServer:false});
require(resolve('out/main/index.js'));
