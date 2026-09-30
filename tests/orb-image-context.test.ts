import { expect, it } from "vitest";
import { limitOrbImages, orbImageBudget } from "../pi-package/extensions/orb-image-context";
const image=(id:number)=>({type:"image",data:Buffer.from(`pixels-${id}`).toString("base64"),mimeType:"image/png"});
const result=(name:string,ids:number[])=>({role:"toolResult",toolName:name,toolCallId:`call-${ids[0]}`,content:[{type:"text",text:"action completed; observation_id obs; window Target"},...ids.map(image)]});

it("retains three newest images across a batch and multiple results without mutating history",()=>{
  const messages=[result("orb_observe",[0]),result("orb_batch",[1,2,3,4]),result("orb_type",[5])];
  const original=JSON.stringify(messages);const projected=limitOrbImages(messages);
  expect(orbImageBudget(projected).images).toBe(3);
  const retained=projected.flatMap(m=>m.content).filter(b=>b.type==="image");expect(retained).toEqual([image(3),image(4),image(5)]);
  expect(JSON.stringify(messages)).toBe(original);
  expect(projected.map(m=>m.toolCallId)).toEqual(messages.map(m=>m.toolCallId));
  expect(projected[0]?.content[0]).toEqual(messages[0]?.content[0]);
  expect(limitOrbImages(messages)).toEqual(projected);
  expect(limitOrbImages(projected)).toEqual(projected);
});

it("preserves user uploads, confirmed shares, other tools and unknown tool origins",()=>{
  const user={role:"user",content:[image(9)]};const other=result("read",[8]);const unknown={role:"toolResult",content:[image(7)]};
  const messages=[user,other,unknown,...Array.from({length:20},(_,id)=>result("orb_observe",[id]))];
  const projected=limitOrbImages(messages);expect(projected[0]).toBe(user);expect(projected[1]).toBe(other);expect(projected[2]).toBe(unknown);
  const budget=orbImageBudget(projected);expect(budget.images).toBe(3);expect(budget.bytes).toBe(Buffer.byteLength('pixels-17pixels-18pixels-19'));
});
