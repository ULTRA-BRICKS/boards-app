/**
 * Photo transcription review. Two parts:
 *  - createPhotoReviewSession(cell): the PURE, DOM-free edit/confirm state (title, column titles,
 *    thoughts, keep flags, consent, in-flight submission). `cell` is any {get,peek,set} holder; the board
 *    passes the `photoReview` scope owner, so sign-out wipes an unfinished review atomically.
 *  - reviewPhoto(host,draft,opts): the DOM form. Inputs stay the live editing surface (no value rewrites,
 *    so IME composition is never interrupted); their values are mirrored into the session on input and
 *    re-synced right before a submit, so the confirmed value is exactly what the user sees.
 * No imports: the browser loads this file by absolute URL and node tests import it directly.
 */
const deepFreeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const key of Object.keys(value))deepFreeze(value[key])}return value};
const INVALID='Name the page and its columns, and keep at least one thought.';
const plainCell=initial=>{let value=initial;return {get:()=>value,peek:()=>value,set:next=>{value=next}}};

export function createPhotoReviewSession(cell=plainCell(null)){
 const read=()=>cell.peek();
 const write=next=>cell.set(deepFreeze(next));
 const edit=(update)=>{const current=read();if(!current)return;const next=update(current);if(next!==current)write(next)};
 const setItem=(ci,ii,change)=>edit(s=>{const column=s.columns[ci],item=column?.items[ii];if(!item)return s;const patch=change(item);if(patch===item)return s;
  return {...s,columns:s.columns.map((c,i)=>i!==ci?c:{...c,items:c.items.map((x,j)=>j!==ii?x:patch)})}});
 const field=(item,key,value)=>item[key]===value?item:{...item,[key]:value};
 return {
  open(draft){
   const board=structuredClone(draft.board);
   write({...board,columns:board.columns.map(c=>({...c,items:c.items.map(x=>({...x,keep:true}))})),warnings:[...(draft.warnings||[])],consent:false,submitting:false,run:{}});
  },
  view:()=>read(),
  close(){cell.set(null)},
  setTitle:title=>edit(s=>s.title===title?s:{...s,title}),
  setColumnTitle:(ci,title)=>edit(s=>!s.columns[ci]||s.columns[ci].title===title?s:{...s,columns:s.columns.map((c,i)=>i===ci?{...c,title}:c)}),
  setText:(ci,ii,text)=>setItem(ci,ii,x=>field(x,'text',text)),
  setHint:(ci,ii,tag)=>setItem(ci,ii,x=>field(x,'tag',tag)),
  setKeep:(ci,ii,keep)=>setItem(ci,ii,x=>field(x,'keep',keep)),
  setConsent:consent=>edit(s=>s.consent===consent?s:{...s,consent}),
  /** Applies the legacy confirmation rules. Returns null when closed or already submitting; throws when invalid. */
  submit(){
   const s=read();if(!s||s.submitting)return null;
   const {columns,warnings,consent,submitting,run,...board}=s;
   const value={...board,title:(s.title||'').trim(),columns:columns.map(({items,...column})=>({...column,title:(column.title||'').trim(),items:items.filter(x=>x.keep).map(({keep,...x})=>({...x,text:(x.text||'').trim(),tag:(x.tag||'').trim(),assignees:[]})).filter(t=>t.text)})).filter(c=>c.items.length)};
   if(!value.title||!value.columns.length||value.columns.some(c=>!c.title))throw Error(INVALID);
   write({...s,submitting:true});
   return {value,done(){const now=read();if(now&&now.run===run&&now.submitting)write({...now,submitting:false})}};
  },
 };
}

/** Accessible transcription review; no JSON editing required. The caller owns persistence. */
export function reviewPhoto(host,draft,{onConfirm,onError=()=>{},session=createPhotoReviewSession()}={}) {
 const board=structuredClone(draft.board);
 session.open(draft);
 const field=(label,value,{multiline=false,max=120}={})=>{
  const wrapper=document.createElement('label');wrapper.append(document.createTextNode(label));
  const input=document.createElement(multiline?'textarea':'input');input.value=value||'';input.maxLength=max;
  if(multiline)input.rows=2;wrapper.append(input);return {wrapper,input};
 };
 host.replaceChildren();
 const warning=document.createElement('p');warning.className='notice';
 warning.textContent=draft.warnings?.length?draft.warnings.join(' · '):'Please check every line against your photo. Names in brackets remain unconfirmed assignee hints.';
 host.append(warning);
 const form=document.createElement('form');form.className='photo-review';
 const title=field('Page title',board.title);title.input.addEventListener('input',()=>session.setTitle(title.input.value));form.append(title.wrapper);
 const rows=[];
 for(const column of board.columns){
  const section=document.createElement('fieldset');section.className='review-column';
  const legend=document.createElement('legend');legend.textContent='Column';section.append(legend);
  const heading=field('Column title',column.title);section.append(heading.wrapper);const ci=rows.length;heading.input.addEventListener('input',()=>session.setColumnTitle(ci,heading.input.value));
  const entries=[];
  for(const item of column.items){
   const row=document.createElement('div');row.className='review-row';
   const keep=document.createElement('input');keep.type='checkbox';keep.checked=true;keep.setAttribute('aria-label','Include this thought');
   const text=field('Thought',item.text,{multiline:true,max:1000});
   const hint=field('Assignee hint (not confirmed)',item.tag,{max:24});
   const ii=entries.length;keep.addEventListener('change',()=>session.setKeep(ci,ii,keep.checked));text.input.addEventListener('input',()=>session.setText(ci,ii,text.input.value));hint.input.addEventListener('input',()=>session.setHint(ci,ii,hint.input.value));
   row.append(keep,text.wrapper,hint.wrapper);section.append(row);entries.push({item,keep,text:text.input,hint:hint.input});
  }
  form.append(section);rows.push({column,heading:heading.input,entries});
 }
 const consent=document.createElement('label');consent.className='review-consent';
 const checked=document.createElement('input');checked.type='checkbox';checked.required=true;checked.addEventListener('change',()=>session.setConsent(checked.checked));
 consent.append(checked,document.createTextNode('I checked the transcription. Create a new page without changing existing pages.'));
 const button=document.createElement('button');button.className='primary';button.type='submit';button.textContent='Confirm and add page';
 form.append(consent,button);host.append(form);
 // Programmatic value changes fire no input event, so mirror the DOM once more before confirming.
 const sync=()=>{session.setTitle(title.input.value);rows.forEach(({heading,entries},ci)=>{session.setColumnTitle(ci,heading.value);entries.forEach((x,ii)=>{session.setKeep(ci,ii,x.keep.checked);session.setText(ci,ii,x.text.value);session.setHint(ci,ii,x.hint.value)})});session.setConsent(checked.checked)};
 form.onsubmit=async event=>{
  event.preventDefault();if(!form.reportValidity())return;
  sync();let submission;
  try{submission=session.submit()}catch(error){onError(error);return}
  if(!submission)return;
  button.disabled=true;
  try{await onConfirm(submission.value)}catch(error){onError(error)}finally{submission.done();if(button.isConnected)button.disabled=false}
 };
 return form;
}
