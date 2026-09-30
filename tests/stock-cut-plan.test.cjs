"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const html=fs.readFileSync(path.join(__dirname,"../stock_cut_plan.html"),"utf8");
const context=vm.createContext({});
vm.runInContext(html.match(/<script id="planner-code">([\s\S]*?)<\/script>/)[1],context);
const api=context.StockCutPlan;
const plain=value=>JSON.parse(JSON.stringify(value));
function config(stock=2000,kerf=2,start=0,end=0,mode="each") {return api.settings(String(stock),String(kerf),String(start),String(end),mode);}
function verify(result,requested) {
    const actual=[];
    let bars=0,offcuts=0,kerf=0;
    for(const g of result.groups){
        assert(g.remaining>=0);
        assert.equal(g.sum+g.kerfs*result.config.kerf+g.remaining+result.config.trimStart+result.config.trimEnd,result.config.stock);
        for(let i=0;i<g.quantity;i++) actual.push(...g.cuts);
        bars+=g.quantity;offcuts+=g.remaining*g.quantity;kerf+=g.kerfs*result.config.kerf*g.quantity;
    }
    assert.deepEqual(actual.sort((a,b)=>a-b),Array.from(requested).sort((a,b)=>a-b));
    assert.equal(bars,result.count);assert.equal(offcuts,result.offcuts);assert.equal(kerf,result.sawLoss);
    assert.equal(result.total+result.offcuts+result.sawLoss+result.trimLoss,result.purchased);
}

test("unambiguous quantities, mixed units and exact decimal measurements",()=>{
    assert.deepEqual(plain(api.parse("400 x 2, 2 x 400mm, 1.2m x 2, 3 × 12.5cm\n.5mm")),[400000,400000,400000,400000,1200000,1200000,125000,125000,125000,500]);
    assert.deepEqual(plain(api.parse("600, 600, 800, 400 x 2\n1.2m x 2")),[600000,600000,800000,400000,400000,1200000,1200000]);
    assert.equal(api.length("0.000001","m"),1);
    assert.throws(()=>api.parse("0.0001mm"),/not rounded/);
    assert.throws(()=>api.parse("2 x 0mm"),/greater than zero/);
    for(const input of ["", "-5", "1..2", "5mm x 0", "0 x 10mm", "600 x 2001", "abc", "Infinity", "1e3"]){assert.throws(()=>api.parse(input),input);}
});

test("reject invalid stock, trims, kerf and pieces which do not fit",()=>{
    for(const input of [[0,2,0,0],[-1,2,0,0],[2000,-1,0,0],[2000,2,-1,0],[2000,2,1000,1000],[2000,2,1500,700]]) assert.throws(()=>config(...input));
    assert.throws(()=>api.plan(api.parse("2001"),config()),/will not fit/);
    assert.throws(()=>api.plan(api.parse("1999"),config()),/kerf allowance/);
    assert.throws(()=>api.plan(api.parse("1990"),config(2000,2,10,10)),/will not fit/);
});

test("final cut allowance, exact end finish and explicit original convention",()=>{
    const a=api.plan(api.parse("998"),config(1000,2));
    assert.equal(a.count,1);assert.equal(a.sawLoss,2000);assert.equal(a.offcuts,0);
    const b=api.plan(api.parse("1000"),config(1000,2));
    assert.equal(b.sawLoss,0);assert.equal(b.offcuts,0);
    const c=api.plan(api.parse("499 x 2"),config(1000,2));
    assert.equal(c.count,1);assert.equal(c.groups[0].kerfs,1);verify(c,api.parse("499 x 2"));
    const d=api.plan(api.parse("499 x 2"),config(999,2,0,0,"between"));
    assert.equal(d.count,2);assert.equal(d.sawLoss,0);
    const e=api.plan(api.parse("300 x 2"),config(1000,2,10,20));
    assert.equal(e.sawLoss,4000);assert.equal(e.trimLoss,30000);assert.equal(e.offcuts,366000);verify(e,api.parse("300 x 2"));
    const f=api.plan(api.parse("300 x 2"),config(1000,2,10,20,"between"));
    assert.equal(f.sawLoss,2000);assert.equal(f.offcuts,368000);
    const decimal=api.plan(api.parse("49.25 x 2"),config(100,1.5));
    assert.equal(decimal.count,1);assert.equal(decimal.offcuts,0);assert.equal(decimal.sawLoss,1500);
});

test("bounded search improves a greedy counterexample and accounts for the example",()=>{
    const tricky=api.parse("6,5,3,2,2,2");
    const result=api.plan(tricky,config(10,0));
    assert.equal(result.count,2);assert.equal(result.minimum,true);verify(result,tricky);
    const pieces=api.parse("600, 600, 800, 400 x 2\n1.2m x 2");
    const example=api.plan(pieces,config());
    assert.equal(example.count,3);assert.equal(example.total,5200000);verify(example,pieces);
    assert(api.report(example).includes("Pieces: 7"));
    assert(api.report(example).includes("Kerf loss:"));
});

// Independent exhaustive assignment for small cases. Account for kerf only
// after complete partitions, rather than following the planner's insertion rule.
function oracle(pieces,stock,kerf,mode){
    let best=pieces.length;
    const bins=[];
    function visit(i){
        if(bins.length>best)return;
        if(i===pieces.length){
            if(bins.every(bin=>{
                const sum=bin.reduce((a,b)=>a+b,0);
                const between=sum+(bin.length-1)*kerf;
                return mode==="between"?between<=stock:between===stock||sum+bin.length*kerf<=stock;
            }))best=Math.min(best,bins.length);
            return;
        }
        for(const bin of bins){
            if(bin.reduce((a,b)=>a+b,0)+pieces[i]+bin.length*kerf>stock)continue;
            bin.push(pieces[i]);visit(i+1);bin.pop();
        }
        bins.push([pieces[i]]);visit(i+1);bins.pop();
    }
    visit(0);return best;
}
test("small-case optimum agrees with independent exhaustive assignments",()=>{
    let seed=31;
    const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed;};
    for(const mode of ["each","between"]){
        for(let n=0;n<100;n++){
            const raw=Array.from({length:3+random()%5},()=>1+random()%8);
            const kerf=random()%2;
            const pieces=raw.map(v=>v*1000);
            const result=api.plan(pieces,config(10,kerf,0,0,mode));
            assert.equal(result.count,oracle(raw,10,kerf,mode),JSON.stringify({raw,kerf,mode}));
            assert.equal(result.minimum,true);verify(result,pieces);
        }
    }
});

test("large plans remain bounded and do not claim an unproven optimum",()=>{
    const pieces=api.parse("6 x 25, 5 x 25, 3 x 25, 2 x 75");
    const result=api.plan(pieces,config(10,0));verify(result,pieces);
    if(result.count>result.lowerBound)assert.equal(result.minimum,false);
    const maximum=api.parse("1 x 2000");
    verify(api.plan(maximum,config(2000,0)),maximum);
});
