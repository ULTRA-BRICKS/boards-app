import test from 'node:test';
import assert from 'node:assert/strict';
import {setAssignee,unresolvedHints} from '../packages/core/assignees.mjs';
const people=[{id:'mariam',name:'Mariam'},{id:'niko',name:'Niko'},{id:'danny',name:'Danny'}];
test('assigning Niko does not silently lose S or Mariam from S/M',()=>{const item={tag:'S/M',assignees:['mariam']};setAssignee(item,people[1]);assert.equal(item.tag,'S/M');assert.deepEqual(unresolvedHints(item,people),['S']);assert.deepEqual(item.assignees,['mariam','niko'])});
test('explicit resolution consumes only the selected unknown hint',()=>{const item={tag:'S/M',assignees:['mariam']};setAssignee(item,people[2],{resolveHint:'S'});assert.equal(item.tag,'M');assert.deepEqual(unresolvedHints(item,people),[])});
test('mentioning an existing person is idempotent; removing a person does not remove unrelated hints',()=>{const item={tag:'S/M',assignees:['mariam']};setAssignee(item,people[0]);setAssignee(item,people[0]);assert.deepEqual(item.assignees,['mariam']);assert.equal(item.tag,'S');setAssignee(item,people[0],{remove:true});assert.deepEqual(item.assignees,[]);assert.equal(item.tag,'S')});
test('unknown initial is not guessed from a matching first letter',()=>assert.deepEqual(unresolvedHints({tag:'S',assignees:['someone']},[{id:'someone',name:'Sam'}]),['S']));
