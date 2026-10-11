import test from "node:test";
import assert from "node:assert/strict";
import { watchDashboardSection } from "../../src/lib/dashboard-viewport.ts";
test("dashboard summary loads only when near viewport, once",()=>{
 let spy,loaded=0;
 class Observer{constructor(cb,o){this.cb=cb;this.options=o;spy=this;}observe(node){this.node=node;}disconnect(){this.closed=true;}emit(v){this.cb([{isIntersecting:v}],this);}}
 const node={name:"section"},stop=watchDashboardSection(node,()=>loaded++,Observer);
 assert.equal(loaded,0);assert.equal(spy.node,node);assert.equal(spy.options.rootMargin,"320px 0px");
 spy.emit(false);assert.equal(loaded,0);
 spy.emit(true);spy.emit(true);assert.equal(loaded,1);assert.equal(spy.closed,true);stop();
});
test("fallback loads without IntersectionObserver",()=>{
 let n=0;watchDashboardSection({},()=>n++,undefined);assert.equal(n,1);
});
test("unmount prevents late activation",()=>{
 let spy,n=0;
 class Observer{constructor(cb){this.cb=cb;spy=this;}observe(){}disconnect(){}}
 const stop=watchDashboardSection({},()=>n++,Observer);stop();spy.cb([{isIntersecting:true}]);assert.equal(n,0);
});
