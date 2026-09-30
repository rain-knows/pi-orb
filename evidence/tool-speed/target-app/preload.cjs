const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('speed',{report:value=>ipcRenderer.send('speed-event',value),dialog:()=>ipcRenderer.send('speed-dialog')});
