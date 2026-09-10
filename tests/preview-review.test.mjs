import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspace,projectShare} from '../packages/core/workspace.mjs';
import {makePreview} from '../server/preview.mjs';
test('multiline focus text reflows within the PNG instead of clipping hundreds of source lines',()=>{
 const w=createWorkspace();w.boards[0].columns[1].items[1].text=('Очень\n'.repeat(160)).trim();
 const v=projectShare(w,{kind:'item',boardId:'roadmap',itemIds:['p2']});const before=JSON.stringify(v);const scene=makePreview(v);
 assert.equal(JSON.stringify(v),before);assert.ok(scene.layout.every(row=>row.y<=630&&row.x+row.width<=1200));assert.ok(scene.layout.some(row=>row.text.includes('Очень Очень')));
});
