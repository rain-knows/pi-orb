// Disposable ground-truth target. No user data and no product UI.
import { app, BrowserWindow, ipcMain, screen, Menu } from "electron";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = process.env.PI_ORB_SPEED_ROOT;
if (!root) throw new Error("Missing isolated evidence directory");
let win;
ipcMain.on("speed-event", (_event, value) => appendFileSync(join(root, "events.jsonl"), `${JSON.stringify({ at: Date.now(), ...value })}\n`));
const html = `<!doctype html><meta charset="utf-8"><title>Orb speed target</title>
<style>body{font:18px system-ui;padding:20px;background:#fff}button,input{display:block;margin:12px;padding:10px;font:inherit}#popup{display:none;padding:15px;background:#eee}#popup.open{display:block}</style>
<button id="a">A: 0</button><button id="b">B: 0</button><button id="c">C: 0</button>
<input id="text" placeholder="测试输入"><button id="menu">打开菜单</button><div id="popup"><button id="item">菜单项</button></div><button id="dialog">打开弹窗</button><button id="close">关闭菜单</button>
<script>
const report=(kind,extra={})=>window.speed.report({kind,...extra});
for(const id of ['a','b','c']){let count=0;document.getElementById(id).onclick=()=>{count++;document.getElementById(id).textContent=id.toUpperCase()+': '+count;report('click',{id,count});};}
text.oninput=()=>report('input',{value:text.value});text.onkeydown=e=>{if(e.key==='Enter')report('submit',{value:text.value});};
menu.onclick=()=>{setTimeout(()=>{popup.classList.add('open');report('menu-ready');},450);report('menu-click');};
item.onclick=()=>report('menu-item');close.onclick=()=>{popup.classList.remove('open');report('menu-closed');};
dialog.onclick=()=>window.speed.dialog();
for(const type of ['keydown','keyup','mousedown','mouseup'])window.addEventListener(type,e=>report(type,{key:e.key??null,id:e.target.id,x:e.clientX,y:e.clientY}));
</script>`;
app.whenReady().then(async()=>{
  Menu.setApplicationMenu(null);
  win=new BrowserWindow({width:650,height:850,x:180,y:70,webPreferences:{preload:join(import.meta.dirname,'preload.cjs')}});
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  const points=await win.webContents.executeJavaScript(`Object.fromEntries(['a','b','c','text','menu','dialog','close'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return [id,{x:r.x+r.width/2,y:r.y+r.height/2}]}))`);
  const bounds=win.getContentBounds();
  for(const [id,p] of Object.entries(points))points[id]=screen.dipToScreenPoint({x:Math.round(bounds.x+p.x),y:Math.round(bounds.y+p.y)});
  writeFileSync(join(root,'geometry.json'),JSON.stringify({points,bounds:win.getBounds(),contentBounds:bounds}));
  ipcMain.on('speed-dialog',()=>{
    const child=new BrowserWindow({parent:win,width:300,height:160,modal:true,title:'Orb speed dialog'});
    child.loadURL('data:text/html,<title>Orb speed dialog</title><button onclick="window.close()">close</button>');
    child.once('ready-to-show',()=>child.show());
    appendFileSync(join(root,'events.jsonl'),JSON.stringify({at:Date.now(),kind:'dialog-created'})+'\n');
  });
  win.show();win.focus();
});
app.on('window-all-closed',()=>app.quit());
