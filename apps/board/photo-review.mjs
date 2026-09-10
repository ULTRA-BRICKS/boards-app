/** Accessible transcription review; no JSON editing required. The caller owns persistence. */
export function reviewPhoto(host,draft,{onConfirm,onError=()=>{}}={}) {
 const board=structuredClone(draft.board);
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
 const title=field('Page title',board.title);form.append(title.wrapper);
 const rows=[];
 for(const column of board.columns){
  const section=document.createElement('fieldset');section.className='review-column';
  const legend=document.createElement('legend');legend.textContent='Column';section.append(legend);
  const heading=field('Column title',column.title);section.append(heading.wrapper);
  const entries=[];
  for(const item of column.items){
   const row=document.createElement('div');row.className='review-row';
   const keep=document.createElement('input');keep.type='checkbox';keep.checked=true;keep.setAttribute('aria-label','Include this thought');
   const text=field('Thought',item.text,{multiline:true,max:1000});
   const hint=field('Assignee hint (not confirmed)',item.tag,{max:24});
   row.append(keep,text.wrapper,hint.wrapper);section.append(row);entries.push({item,keep,text:text.input,hint:hint.input});
  }
  form.append(section);rows.push({column,heading:heading.input,entries});
 }
 const consent=document.createElement('label');consent.className='review-consent';
 const checked=document.createElement('input');checked.type='checkbox';checked.required=true;
 consent.append(checked,document.createTextNode('I checked the transcription. Create a new page without changing existing pages.'));
 const button=document.createElement('button');button.className='primary';button.type='submit';button.textContent='Confirm and add page';
 form.append(consent,button);host.append(form);
 form.onsubmit=async event=>{
  event.preventDefault();if(!form.reportValidity())return;
  const value={...board,title:title.input.value.trim(),columns:rows.map(({column,heading,entries})=>({...column,title:heading.value.trim(),items:entries.filter(x=>x.keep.checked).map(x=>({...x.item,text:x.text.value.trim(),tag:x.hint.value.trim(),assignees:[]})).filter(t=>t.text)})).filter(c=>c.items.length)};
  if(!value.title||!value.columns.length||value.columns.some(c=>!c.title)){onError(Error('Name the page and its columns, and keep at least one thought.'));return;}
  button.disabled=true;
  try{await onConfirm(value)}catch(error){onError(error)}finally{if(button.isConnected)button.disabled=false}
 };
 return form;
}
