import { describe, expect, it, vi } from 'vitest';
import { initPaperStockPicker, paintPaperPreview } from './paper-stock-picker.js';

class Element extends EventTarget {
  constructor(tag, document) { super(); this.tagName=tag; this.document=document; this.children=[]; this.attributes={}; this.dataset={}; this.value=''; this.open=false; }
  append(...nodes) { for(const node of nodes) { node.remove(); node.parent=this; this.children.push(node); } }
  remove() { if(this.parent) this.parent.children=this.parent.children.filter(n=>n!==this); this.parent=null; }
  replaceWith(node) { const parent=this.parent; const at=parent.children.indexOf(this); this.remove(); parent.children.splice(at,0,node); node.parent=parent; }
  closest() { return this.parent; }
  setAttribute(name,value) { this.attributes[name]=value; }
  removeAttribute(name) { delete this.attributes[name]; }
  focus() { this.document.activeElement=this; }
  showModal() { this.open=true; }
  close() { this.open=false; this.dispatchEvent(new Event('close')); }
  getContext() { return null; }
}
function fixture() {
  const doc={defaultView:{Event}, createElement(tag){return new Element(tag,this);},getElementById(){return this.body;}};
  doc.body=new Element('body',doc);
  const label=new Element('label',doc);
  const select=new Element('select',doc);
  select.value='cotton';
  doc.body.append(label); label.append(select);
  const picker=initPaperStockPicker({select,documentRef:doc});
  return {doc,select,picker,choices:picker.dialog.children[2].children};
}
describe('visual stationery picker',()=>{
  it('opens without changing the preference and focuses the selected sheet',()=>{
    const {select,picker,doc,choices}=fixture();
    const changes=vi.fn(); select.addEventListener('change',changes);
    picker.open();
    expect(picker.dialog.open).toBe(true);
    expect(doc.activeElement).toBe(choices[1]);
    expect(select.hidden).toBe(true);
    expect(changes).not.toHaveBeenCalled();
    expect(choices.map(n=>n.attributes['aria-pressed'])).toEqual(['false','true','false','false']);
  });
  it('commits a clicked finish through the existing bubbling change event',()=>{
    const {select,picker,doc,choices}=fixture();
    const changes=[]; select.addEventListener('change',event=>changes.push({value:select.value,bubbles:event.bubbles}));
    picker.open(); choices[3].dispatchEvent(new Event('click'));
    expect(changes).toEqual([{value:'laid',bubbles:true}]);
    expect(picker.dialog.open).toBe(false);
    expect(doc.activeElement).toBe(picker.button);
    expect(picker.button.textContent).toContain('Laid Writing Paper');
  });
  it('leaves the preference intact on dismissal and tracks external changes',()=>{
    const {select,picker}=fixture();
    picker.open(); picker.dialog.close(); expect(select.value).toBe('cotton');
    select.value='onionskin'; select.dispatchEvent(new Event('change'));
    expect(picker.button.textContent).toContain('Onionskin');
  });
  it('restores the select on teardown',()=>{
    const {select,picker}=fixture(); picker.destroy();
    expect(select.hidden).toBe(false); expect(picker.dialog.parent).toBe(null);
  });
  it('paints readable previews with the shared stationery surface renderer',()=>{
    const words=[]; const gradient={addColorStop:vi.fn()};
    const context={createLinearGradient:()=>gradient,fillRect:vi.fn(),beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(text){words.push(text);}};
    const canvas={getContext:()=>context}; paintPaperPreview(canvas,'laid');
    expect(canvas.width).toBe(440); expect(canvas.height).toBe(560);
    expect(gradient.addColorStop).toHaveBeenCalledTimes(3);
    expect(context.fillRect.mock.calls.length).toBeGreaterThan(100);
    expect(words).toContain('Every story begins');
    expect(context.fillStyle).toBe('#171717');
  });
});
