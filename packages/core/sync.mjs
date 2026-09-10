/** Serial save queue; never confirms an edit that was made after its request. */
export class SyncQueue{
 constructor({send,onState=()=>{},delay=550}){Object.assign(this,{send,onState,delay,version:0,enabled:false,paused:false,running:false,sequence:0,ack:0,document:null,timer:null})}
 configure({enabled,version=0}){this.enabled=enabled;this.version=version;this.paused=false;if(enabled&&this.sequence>this.ack)this.schedule()}
 change(document){this.document=structuredClone(document);this.sequence++;this.onState({kind:this.enabled?'pending':'local'});if(this.enabled)this.schedule()}
 schedule(){clearTimeout(this.timer);this.timer=setTimeout(()=>this.flush(),this.delay)}
 async flush(){clearTimeout(this.timer);if(!this.enabled||this.paused||this.running||this.sequence===this.ack||!this.document)return;this.running=true;const seq=this.sequence,document=structuredClone(this.document);this.onState({kind:'saving'});try{const result=await this.send({document,version:this.version});if(result.conflict){this.paused=true;this.onState({kind:'conflict',remote:result.remote});return}if(!Number.isInteger(result.version)||result.version<=this.version)throw Error('Сервер вернул неверную версию');this.version=result.version;this.ack=seq;this.onState({kind:this.sequence===seq?'saved':'pending',version:this.version,document});}catch(error){this.paused=true;this.onState({kind:'error',message:error.message})}finally{this.running=false;if(!this.paused&&this.sequence>this.ack)this.schedule()}}
 resolve(version,document){this.version=version;this.paused=false;this.change(document)}
 retry(){this.paused=false;this.flush()}
 dispose(){clearTimeout(this.timer)}
}
