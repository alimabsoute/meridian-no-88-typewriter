import { describe, it, expect } from 'vitest';
import { paperActionState } from './paper-context-actions.js';
describe('contextual paper actions', () => {
  it('stays quiet during writing and motion', () => {
    expect(paperActionState({insertedSheet:{id:'a'}}).visible).toBe(false);
    expect(paperActionState({looseSheet:{page:{id:'a'}}},true).visible).toBe(false);
  });
  it('offers page fate only for a released sheet', () => {
    expect(paperActionState({looseSheet:{page:{id:'a'}}})).toMatchObject({visible:true,chooseStock:false});
  });
  it('offers the next paper stock when empty', () => {
    expect(paperActionState({})).toMatchObject({visible:true,chooseStock:true});
  });
});
