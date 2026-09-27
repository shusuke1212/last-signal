(function(){
'use strict';

const STORAGE_KEY='lastSignal.echoMemory.v1';
const VERSION=1;
const BRAIN_COUNT=10;
const ACTIONS=['rush','strafe','flank','retreat','hold'];
const CONTEXTS=['close','mid','far','lowhp','outnumbered'];
const IDLE_ACTIONS=['patrol','shadow','ambush'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function relation(){return{trust:0,hostility:0,cooperation:0,threat:0,encounters:0,assists:0,betrayals:0}}
function seededNoise(id,n){let x=Math.sin((id+1)*91.733+(n+1)*37.119)*43758.5453;return(x-Math.floor(x))*2-1}
function makeBrain(id){
 const q={},idle={};let n=0;
 for(const c of CONTEXTS){q[c]={};for(const a of ACTIONS)q[c][a]=seededNoise(id,n++)*.055}
 for(const a of IDLE_ACTIONS)idle[a]=seededNoise(id,n++)*.05;
 return{id,games:0,kills:0,playerKills:0,deaths:0,survivals:0,wins:0,totalSurvival:0,damageDealt:0,damageTaken:0,playerThreat:.06,q,idle,weapons:{},relations:Array.from({length:BRAIN_COUNT},()=>relation()),history:[]}
}
function fresh(){return{version:VERSION,matches:0,createdAt:Date.now(),updatedAt:Date.now(),brains:Array.from({length:BRAIN_COUNT},(_,i)=>makeBrain(i))}}
function normalizeBrain(raw,id){
 const b=Object.assign(makeBrain(id),raw||{});b.id=id;
 for(const c of CONTEXTS){b.q[c]=Object.assign(makeBrain(id).q[c],b.q?.[c]||{})}
 b.idle=Object.assign(makeBrain(id).idle,b.idle||{});b.weapons=b.weapons||{};
 b.relations=Array.from({length:BRAIN_COUNT},(_,i)=>Object.assign(relation(),b.relations?.[i]||{}));
 b.history=Array.isArray(b.history)?b.history.slice(-12):[];return b
}
function load(){
 try{let raw=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(!raw||raw.version!==VERSION)return fresh();raw.brains=Array.from({length:BRAIN_COUNT},(_,i)=>normalizeBrain(raw.brains?.[i],i));return raw}catch(e){return fresh()}
}
let memory=load(),active=false,matchStart=0,matchDuration=1200,roster=[],sessions=new Map(),lastSocialPulse=0;
function save(){memory.updatedAt=Date.now();try{localStorage.setItem(STORAGE_KEY,JSON.stringify(memory))}catch(e){}}
function shuffledBrains(count){let a=Array.from({length:BRAIN_COUNT},(_,i)=>i);for(let i=a.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a.slice(0,count)}
function makeSession(brainId){return{brainId,decisions:[],damageDealt:0,damageTaken:0,kills:0,playerKills:0,pickups:[],social:{},diedAt:null,killedBy:null,lastAction:'patrol',lastContext:'mid'}}
function beginMatch(count=BRAIN_COUNT,duration=1200){
 roster=shuffledBrains(count);sessions=new Map();for(const id of roster)sessions.set(id,makeSession(id));active=true;matchStart=performance.now()/1000;matchDuration=duration;lastSocialPulse=0;return roster.slice()
}
function brainOf(entity){return entity&&Number.isInteger(entity.brainId)?memory.brains[entity.brainId]:null}
function sessionOf(entity){return entity&&Number.isInteger(entity.brainId)?sessions.get(entity.brainId):null}
function contextFor(entity,distance,visibleCount=1){if(entity.hp<34)return'lowhp';if(visibleCount>=3)return'outnumbered';if(distance<12)return'close';if(distance>38)return'far';return'mid'}
function weightedChoice(values,temperature=.68){
 if(Math.random()<.11)return values[Math.floor(Math.random()*values.length)].key;
 let max=Math.max(...values.map(v=>v.value)),weights=values.map(v=>Math.exp((v.value-max)/temperature)),sum=weights.reduce((a,b)=>a+b,0),r=Math.random()*sum;
 for(let i=0;i<values.length;i++){r-=weights[i];if(r<=0)return values[i].key}return values[values.length-1].key
}
function rememberDecision(entity,context,action,target){
 let s=sessionOf(entity);if(!s)return;s.lastAction=action;s.lastContext=context;
 s.decisions.push({context,action,target:target?.brainId??(target?.isPlayer?'player':null),time:performance.now()/1000});if(s.decisions.length>72)s.decisions.shift()
}
function chooseCombat(entity,distance,visibleCount,target){
 let b=brainOf(entity);if(!b)return{context:'mid',action:'strafe',duration:3};let context=contextFor(entity,distance,visibleCount),scores=ACTIONS.map(action=>({key:action,value:b.q[context][action]+seededNoise(b.id,b.games+ACTIONS.indexOf(action))*Math.max(0,.035-b.games*.001)})),action=weightedChoice(scores);
 rememberDecision(entity,context,action,target);return{context,action,duration:2.2+Math.random()*2.8}
}
function updateRecent(entity,reward,depth=9){
 let b=brainOf(entity),s=sessionOf(entity);if(!b||!s)return;let recent=s.decisions.slice(-depth),decay=1;
 for(let i=recent.length-1;i>=0;i--){let d=recent[i],old=b.q[d.context]?.[d.action];if(Number.isFinite(old)){let alpha=.07*Math.min(1,decay);b.q[d.context][d.action]=clamp(old+alpha*(reward-old),-3,3)}decay*=.78}
}
function weaponStat(b,wid){return b.weapons[wid]||(b.weapons[wid]={uses:0,damage:0,kills:0,value:0})}
function weaponPreference(entity,wid){let b=brainOf(entity);if(!b)return 0;return clamp(weaponStat(b,wid).value,-1.5,1.5)}
function onPickup(entity,wid){let b=brainOf(entity),s=sessionOf(entity);if(!b||!s)return;weaponStat(b,wid).uses++;s.pickups.push(wid)}
function targetKey(t){return t?.isPlayer?'player':Number.isInteger(t?.brainId)?'brain:'+t.brainId:null}
function evidenceInterest(actor,target){let b=brainOf(actor);if(!b||!target)return 0;if(target.isPlayer)return clamp(b.playerThreat*.3,0,.75);if(Number.isInteger(target.brainId)){let r=b.relations[target.brainId];return clamp(r.hostility*.55+r.threat*.3-r.trust*.36-r.cooperation*.25,-.6,.8)}return 0}
function investigationBias(actor,source){let b=brainOf(actor);if(!b)return 0;let aggressive=0,cautious=0;for(const c of CONTEXTS){aggressive+=b.q[c].rush+b.q[c].flank+b.q[c].strafe*.35;cautious+=b.q[c].retreat+b.q[c].hold*.55}let bias=(aggressive-cautious)/(CONTEXTS.length*3);bias+=(b.idle.patrol-b.idle.ambush*.35)*.22;if(source==='pickup')bias+=b.idle.ambush*.16;return clamp(bias,-1,1)}
function pickTarget(actor,candidates,aliveCount){
 let b=brainOf(actor);if(!b||!candidates.length)return candidates[0]?.entity||null;let finalPressure=clamp((4-aliveCount)/3,0,1),ranked=[];
 for(const c of candidates){let t=c.entity,score=1.25-c.distance/86+(1-clamp((t.hp||100)/100,0,1))*.32+Math.random()*.13;
  if(c.isPlayer)score+=b.playerThreat*.8+.06;
  else{let r=b.relations[t.brainId];score+=r.hostility*.78+r.threat*.42-r.trust*(1.05-finalPressure*.82)-r.cooperation*(.72-finalPressure*.58)}
  ranked.push({t,score,c})
 }
 ranked.sort((a,z)=>z.score-a.score);let best=ranked[0];
 if(!best.c.isPlayer){let r=b.relations[best.t.brainId],other=ranked.find(x=>x.c.isPlayer||x.score>best.score-.24&&x.t!==best.t);if((r.trust+r.cooperation)>.38&&finalPressure<.65){if(other)return other.t;if(Math.random()<clamp((r.trust+r.cooperation)*.34,0,.62))return null}}
 return best.t
}
function adjustRelation(fromId,toId,delta){
 if(!Number.isInteger(fromId)||!Number.isInteger(toId)||fromId===toId)return;let r=memory.brains[fromId].relations[toId];
 for(const [k,v] of Object.entries(delta))if(k in r)r[k]=clamp(r[k]+v,-2.5,2.5)
}
function onDamage(attacker,victim,damage,wid){
 if(!active||!victim?.alive)return;let amount=Math.max(0,damage||0),ab=brainOf(attacker),vb=brainOf(victim),as=sessionOf(attacker),vs=sessionOf(victim);
 if(ab&&as){as.damageDealt+=amount;ab.damageDealt+=amount;let ws=weaponStat(ab,wid||attacker.wid||'unknown');ws.damage+=amount;ws.value=clamp(ws.value+amount*.0007,-1.5,1.5);updateRecent(attacker,clamp(amount/55,0,.9),4)}
 if(vb&&vs){vs.damageTaken+=amount;vb.damageTaken+=amount;updateRecent(victim,-clamp(amount/70,0,.7),4)}
 if(ab&&vb){adjustRelation(victim.brainId,attacker.brainId,{trust:-amount*.006,hostility:amount*.008,threat:amount*.004,encounters:.02});adjustRelation(attacker.brainId,victim.brainId,{hostility:amount*.002,encounters:.01})}
 if(attacker?.isPlayer&&vb)bumpPlayerThreat(vb,amount*.0045);if(victim?.isPlayer&&ab)bumpPlayerThreat(ab,amount*.001)
}
function bumpPlayerThreat(b,d){b.playerThreat=clamp(b.playerThreat+d,0,2.5)}
function onKill(attacker,victim,enemies){
 if(!active)return;let as=sessionOf(attacker),vs=sessionOf(victim),ab=brainOf(attacker),vb=brainOf(victim),now=performance.now()/1000;
 if(ab&&as){as.kills++;ab.kills++;if(victim?.isPlayer){as.playerKills++;ab.playerKills++;bumpPlayerThreat(ab,.08)}let ws=weaponStat(ab,attacker.wid||'unknown');ws.kills++;ws.value=clamp(ws.value+.14,-1.5,1.5);updateRecent(attacker,2.6,12)}
 if(vb&&vs){vs.diedAt=now;vs.killedBy=attacker?.isPlayer?'player':attacker?.brainId??'environment';updateRecent(victim,-2.8,14)}
 if(ab&&vb){adjustRelation(victim.brainId,attacker.brainId,{trust:-.3,hostility:.42,threat:.22,betrayals:.12});adjustRelation(attacker.brainId,victim.brainId,{hostility:.08,threat:.05})}
 if(attacker?.isPlayer&&vb)bumpPlayerThreat(vb,.28);
 let victimKey=targetKey(victim);if(victimKey&&Array.isArray(enemies)&&ab){for(const ally of enemies){if(!ally.alive||ally===attacker||!Number.isInteger(ally.brainId))continue;if(ally.lastTargetKey===victimKey&&Math.hypot(ally.x-victim.x,ally.z-victim.z)<36){updateRecent(ally,.72,6);adjustRelation(attacker.brainId,ally.brainId,{trust:.055,cooperation:.09,assists:.12});adjustRelation(ally.brainId,attacker.brainId,{trust:.04,cooperation:.075,assists:.12})}}}
}
function socialPulse(enemies,now){
 if(!active||now-lastSocialPulse<1)return;lastSocialPulse=now;
 for(let i=0;i<enemies.length;i++)for(let j=i+1;j<enemies.length;j++){let a=enemies[i],b=enemies[j];if(!a.alive||!b.alive||Math.hypot(a.x-b.x,a.z-b.z)>30)continue;let sa=sessionOf(a),sb=sessionOf(b);if(!sa||!sb)continue;let cooperative=a.lastTargetKey&&a.lastTargetKey===b.lastTargetKey&&a.lastTargetKey!==targetKey(a)&&a.lastTargetKey!==targetKey(b);if(cooperative){sa.social[b.brainId]=(sa.social[b.brainId]||0)+1;sb.social[a.brainId]=(sb.social[a.brainId]||0)+1}}
 if(debugRoot&&!debugRoot.classList.contains('hidden'))refreshDebug(enemies)
}
function pickPartner(actor,enemies){
 let b=brainOf(actor),best=null,bestScore=.25;if(!b)return null;
 for(const other of enemies){if(other===actor||!other.alive||!Number.isInteger(other.brainId))continue;let r=b.relations[other.brainId],d=Math.hypot(actor.x-other.x,actor.z-other.z),score=r.trust+r.cooperation-r.hostility*.72-d/180;if(score>bestScore){bestScore=score;best=other}}
 return best
}
function chooseIdle(actor,partner){let b=brainOf(actor);if(!b)return'patrol';let values=IDLE_ACTIONS.map(key=>({key,value:b.idle[key]+(key==='shadow'&&!partner?-1.4:0)})),action=weightedChoice(values,.76),s=sessionOf(actor);if(s)s.lastAction=action;return action}
function reinforceIdle(actor,action,reward){let b=brainOf(actor);if(!b||!Number.isFinite(b.idle[action]))return;b.idle[action]=clamp(b.idle[action]+.055*(reward-b.idle[action]),-2,2)}
function finishMatch(reason,enemies,elapsed,playerAlive){
 if(!active)return;active=false;memory.matches++;let living=enemies.filter(e=>e.alive),sole=living.length===1&&!playerAlive;
 for(const e of enemies){let b=brainOf(e),s=sessionOf(e);if(!b||!s)continue;b.games++;let survived=!!e.alive,life=s.diedAt?Math.max(0,s.diedAt-matchStart):elapsed;b.totalSurvival+=life;if(s.diedAt)b.deaths++;else{b.survivals++;if(sole)b.wins++}
  let completion=clamp(life/Math.max(1,matchDuration),0,1),reward=(survived?1.25:0)+completion*.9+(sole?3.2:0)+(reason==='RETIRED'?.05:0);updateRecent(e,reward,18);reinforceIdle(e,s.lastAction,reward*.55);
  for(const [otherId,seconds] of Object.entries(s.social)){let t=clamp(seconds/20,0,.28);adjustRelation(e.brainId,+otherId,{trust:t*.35,cooperation:t*.6,encounters:t*.5})}
  for(const r of b.relations){r.trust*=.992;r.hostility*=.994;r.cooperation*=.993;r.threat*=.995}
  b.history.push({match:memory.matches,survived,kills:s.kills,playerKills:s.playerKills,seconds:Math.round(life),lastAction:s.lastAction,at:Date.now()});b.history=b.history.slice(-12)
 }
 save();refreshDebug(enemies)
}
function bestEntry(obj){return Object.entries(obj||{}).sort((a,b)=>b[1]-a[1])[0]||['-',0]}
function strongestRelation(b){let best=null;for(let i=0;i<b.relations.length;i++){if(i===b.id)continue;let r=b.relations[i],score=r.trust+r.cooperation-r.hostility;if(!best||score>best.score)best={id:i,score,r}}return best}
function snapshot(){return{version:memory.version,matches:memory.matches,updatedAt:memory.updatedAt,brains:memory.brains.map(b=>{let combat=[];for(const c of CONTEXTS){let [action,value]=bestEntry(b.q[c]);combat.push({context:c,action,value})}let rel=strongestRelation(b),[idle,idleValue]=bestEntry(b.idle);return{id:b.id,games:b.games,kills:b.kills,playerKills:b.playerKills,deaths:b.deaths,survivals:b.survivals,wins:b.wins,averageSurvival:b.games?Math.round(b.totalSurvival/b.games):0,playerThreat:+b.playerThreat.toFixed(2),idle,idleValue:+idleValue.toFixed(2),combat,relation:rel?{brainId:rel.id,score:+rel.score.toFixed(2),trust:+rel.r.trust.toFixed(2),cooperation:+rel.r.cooperation.toFixed(2),hostility:+rel.r.hostility.toFixed(2)}:null,weapons:Object.entries(b.weapons).sort((a,z)=>z[1].value-a[1].value).slice(0,3)}})}}
function reset(){memory=fresh();save();refreshDebug([])}
function exportData(){return JSON.stringify(memory,null,2)}

let debugRoot=null,adminGate=null,logoTapCount=0,logoTapAt=0;
function installAdminStyle(){
 if(document.getElementById('echoAdminStyle'))return;
 let style=document.createElement('style');style.id='echoAdminStyle';style.textContent='#learningDebug{position:fixed;inset:3vh 3vw;z-index:1200;background:#07100ff2;color:#e9eee9;border:1px solid #ffb24a;padding:16px;overflow:auto;font:12px/1.45 monospace}#learningDebug.hidden,#learningGate.hidden{display:none}#learningDebug h2{color:#ffb24a;margin:0 0 12px}#learningDebug table{width:100%;min-width:720px;border-collapse:collapse}#learningDebug th,#learningDebug td{padding:6px;border-bottom:1px solid #26352f;text-align:left}#learningDebug button,#learningGate button{margin:0 8px 12px 0;padding:8px 12px;background:#17231f;color:#fff;border:1px solid #52645b}#learningGate{position:fixed;inset:0;z-index:1250;display:grid;place-items:center;padding:18px;background:#020706c9;color:#e9eee9;font:13px/1.5 monospace}#learningGate .gateCard{width:min(390px,100%);border:1px solid #ffb24a;background:#07100ff5;padding:22px;box-shadow:0 24px 70px #000}#learningGate h2{margin:0 0 8px;color:#ffb24a}#learningGate p{color:#a9b1a7}#learningGate input{width:100%;height:46px;margin:8px 0 14px;padding:0 12px;background:#101b18;color:#fff;border:1px solid #52645b;font:800 1rem monospace;letter-spacing:.18em;outline:none}#learningGate input:focus{border-color:#ffb24a}#learningGate [data-error]{min-height:20px;margin:0;color:#ff7465}.adminTapTarget{touch-action:manipulation}';document.head.appendChild(style)
}
function ensureDebug(){
 if(debugRoot)return;
 debugRoot=document.createElement('section');debugRoot.id='learningDebug';debugRoot.innerHTML='<h2>ECHO MEMORY / RESEARCH VIEW</h2><button data-a="close">閉じる</button><button data-a="export">JSON出力</button><button data-a="reset">学習初期化</button><div data-view></div>';document.body.appendChild(debugRoot);
 debugRoot.addEventListener('click',e=>{let a=e.target?.dataset?.a;if(a==='close')debugRoot.classList.add('hidden');if(a==='reset'&&confirm('全NPCの学習記憶を初期化しますか？'))reset();if(a==='export'){let blob=new Blob([exportData()],{type:'application/json'}),u=URL.createObjectURL(blob),x=document.createElement('a');x.href=u;x.download='echo_memory_export.json';x.click();setTimeout(()=>URL.revokeObjectURL(u),500)}})
}
function ensureAdminGate(){
 if(adminGate)return;
 adminGate=document.createElement('section');adminGate.id='learningGate';adminGate.className='hidden';adminGate.innerHTML='<form class="gateCard"><h2>RESEARCH ACCESS</h2><p>ECHO MEMORY 管理コードを入力してください。</p><input data-code type="password" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="管理コード"><p data-error></p><button type="submit">開く</button><button type="button" data-cancel>キャンセル</button></form>';document.body.appendChild(adminGate);
 let form=adminGate.querySelector('form'),input=adminGate.querySelector('[data-code]'),error=adminGate.querySelector('[data-error]');
 form.addEventListener('submit',e=>{e.preventDefault();if(input.value.trim().toUpperCase()!=='ALICE'){error.textContent='コードが違います。';input.value='';input.focus();return}input.value='';error.textContent='';adminGate.classList.add('hidden');ensureDebug();debugRoot.classList.remove('hidden');refreshDebug(window.__lastSignalEnemies||[])});
 adminGate.querySelector('[data-cancel]').addEventListener('click',()=>adminGate.classList.add('hidden'));
 adminGate.addEventListener('pointerdown',e=>{if(e.target===adminGate)adminGate.classList.add('hidden')})
}
function openAdminGate(){ensureAdminGate();let input=adminGate.querySelector('[data-code]');adminGate.querySelector('[data-error]').textContent='';input.value='';adminGate.classList.remove('hidden');setTimeout(()=>input.focus(),40)}
function initDebug(){
 if(typeof document==='undefined')return;installAdminStyle();ensureAdminGate();let logo=document.querySelector('#start .title');if(!logo)return;logo.classList.add('adminTapTarget');
 logo.addEventListener('pointerup',()=>{let now=performance.now();logoTapCount=now-logoTapAt>3000?1:logoTapCount+1;logoTapAt=now;if(logoTapCount>=5){logoTapCount=0;openAdminGate()}})
}
function refreshDebug(currentEnemies=[]){
 if(!debugRoot)return;let snap=snapshot(),mapping=new Map(currentEnemies.filter(e=>Number.isInteger(e.brainId)).map(e=>[e.brainId,{name:e.name,awareness:e.awareness||'calm',source:e.belief?.source||'-'}]));
 debugRoot.querySelector('[data-view]').innerHTML='<p>累計 '+snap.matches+' 試合　タイトルロゴを5回タップして再表示</p><table><thead><tr><th>内部個体</th><th>現在名</th><th>現在知覚</th><th>戦績</th><th>生存</th><th>脅威</th><th>強い行動</th><th>関係</th></tr></thead><tbody>'+snap.brains.map(b=>{let best=b.combat.sort((a,z)=>z.value-a.value)[0],r=b.relation,m=mapping.get(b.id);return`<tr><td>BRAIN-${String(b.id+1).padStart(2,'0')}</td><td>${m?.name||'-'}</td><td>${m?m.awareness+' / '+m.source:'-'}</td><td>${b.kills}K / ${b.deaths}D / ${b.survivals}S</td><td>${b.averageSurvival}s</td><td>${b.playerThreat}</td><td>${best.context}:${best.action} ${best.value.toFixed(2)}</td><td>${r?'B'+String(r.brainId+1).padStart(2,'0')+' '+r.score:'-'}</td></tr>`}).join('')+'</tbody></table>'
}
if(typeof document!=='undefined'){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initDebug);else initDebug()}
window.LSLearning={beginMatch,brainOf,sessionOf,chooseCombat,pickTarget,pickPartner,chooseIdle,rememberDecision,weaponPreference,evidenceInterest,investigationBias,onPickup,onDamage,onKill,socialPulse,finishMatch,snapshot,reset,exportData,refreshDebug,targetKey,_memory:()=>memory};
})();
