import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import orbExtension from "../pi-package/extensions/orb";
import { BridgeClient } from "../pi-package/extensions/bridge-client";

it("binds resized pixels to session, generation and observation; refuses before bridge and prevalidates the whole batch", async () => {
  const directory = mkdtempSync(join(tmpdir(),"orb-pixel-extension-"));
  const config = join(directory,"config.json");
  writeFileSync(config,JSON.stringify({version:1,orbWorkspace:directory,shortcut:"Control+Alt+F11",window:{alwaysOnTop:true,width:445,height:632}}));
  vi.stubEnv("PI_ORB_CONFIG",config);
  let generation=7;
  const token=vi.spyOn(BridgeClient.prototype,"readToken").mockImplementation(()=>({version:2,token:"test",pid:1,workspace:directory,pipePath:"unused",generation,createdAt:"now"}));
  const call=vi.spyOn(BridgeClient.prototype,"call").mockResolvedValue({ok:true,result:{ok:true}});
  const handlers = new Map<string,(event: never,ctx: ExtensionContext)=>unknown>();
  const tools=new Map<string,ToolDefinition>();
  const api={on:(name:string,handler:typeof handlers extends Map<string,infer F>?F:never)=>handlers.set(name,handler),registerTool:(tool:ToolDefinition)=>tools.set(tool.name,tool),registerCommand:()=>{}};
  let sessionId="one";
  const ctx={cwd:directory,sessionManager:{getSessionId:()=>sessionId}} as ExtensionContext;
  const bytes=Buffer.alloc(24);bytes.set([137,80,78,71,13,10,26,10]);bytes.write("IHDR",12);bytes.writeUInt32BE(1600,16);bytes.writeUInt32BE(900,20);
  const context={messages:[{role:"toolResult",toolName:"orb_observe",details:{orbImages:[{observationId:"observed"}],result:{image:{width:3200,height:1800}}},content:[{type:"image",data:bytes.toString("base64"),mimeType:"image/png"}]}]};
  const start=()=>handlers.get("before_agent_start")!({systemPromptOptions:{sections:{},promptGuidelines:[]}} as never,ctx);
  const project=()=>handlers.get("context")!(context as never,ctx);
  const click=()=>tools.get("orb_click")!.execute("click",{observation_id:"observed",x:1200,y:450},undefined,undefined,ctx);
  try{
    orbExtension(api as unknown as ExtensionAPI);handlers.get("session_start")!({} as never,ctx);start();
    expect(await click()).toMatchObject({details:{ok:false,reason:"stale-image"}});expect(call).not.toHaveBeenCalled();
    project();await click();
    expect(call.mock.calls[0]![0]).toMatchObject({sessionId:"one",generation:7,action:{position:{x:750,y:500}}});
    expect(tools.get("orb_click")!.parameters).toMatchObject({properties:{x:{minimum:0}}});
    expect((tools.get("orb_click")!.parameters as {properties:{x:{maximum?:number}}}).properties.x.maximum).toBeUndefined();
    call.mockClear();
    await tools.get("orb_batch")!.execute("batch",{observation_id:"observed",actions:[{kind:"click",x:800,y:450},{kind:"click",x:1601,y:450}]},undefined,undefined,ctx);
    expect(call).not.toHaveBeenCalled();
    await tools.get("orb_batch")!.execute("batch",{observation_id:"observed",actions:[{kind:"click",x:1200,y:450},{kind:"drag",start_x:0,start_y:0,end_x:1600,end_y:900}]},undefined,undefined,ctx);
    expect(call.mock.calls[0]![0]).toMatchObject({batch:{actions:[{kind:"click",position:{x:750,y:500}},{kind:"drag",endPosition:{x:1000,y:1000}}]}});
    call.mockClear();sessionId="two";expect(await click()).toMatchObject({details:{reason:"stale-image"}});expect(call).not.toHaveBeenCalled();
    sessionId="one";generation=8;start();expect(await click()).toMatchObject({details:{reason:"stale-image"}});
    project();await click();expect(call).toHaveBeenCalledTimes(1);
    call.mockClear();expect(await tools.get("orb_click")!.execute("stale",{observation_id:"old",x:1,y:1},undefined,undefined,ctx)).toMatchObject({details:{reason:"stale-image"}});expect(call).not.toHaveBeenCalled();
    handlers.get("context")!({messages:[]} as never,ctx);expect(await click()).toMatchObject({details:{reason:"stale-image"}});
  }finally{token.mockRestore();call.mockRestore();vi.unstubAllEnvs();rmSync(directory,{recursive:true,force:true});}
});
