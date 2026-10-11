import test from "node:test";
import assert from "node:assert/strict";
import { pagerWindow } from "../../src/lib/pager-window.ts";

test("mobile pagination displays accurate first/last/count",()=>{
  assert.deepEqual(pagerWindow(55,25,1),{
    page:1,pages:3,first:26,last:50,hasPrevious:true,hasNext:true,
  });
  assert.deepEqual(pagerWindow(55,25,2),{
    page:2,pages:3,first:51,last:55,hasPrevious:true,hasNext:false,
  });
});
test("display window clamps stale filter page and empty list",()=>{
  assert.deepEqual(pagerWindow(4,25,11),{
    page:0,pages:1,first:1,last:4,hasPrevious:false,hasNext:false,
  });
  assert.deepEqual(pagerWindow(0,25,3),{
    page:0,pages:1,first:0,last:0,hasPrevious:false,hasNext:false,
  });
});
test("malformed or impossible pagination fails explicitly",()=>{
  for(const args of [[-1,25,0],[40,0,0],[40,25,NaN],[40,25,Infinity],[40,25,1.5]]){
    assert.throws(()=>pagerWindow(...args),/Invalid pagination/);
  }
});
