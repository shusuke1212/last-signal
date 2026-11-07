(function(){
'use strict';

const STORAGE_KEY='lastSignal.echoMemory.v1';
const VERSION=1;
const BRAIN_COUNT=20;
const MATCH_ROSTER_SIZE=10;
const ACTIONS=['rush','strafe','flank','retreat','hold'];
const CONTEXTS=['close','mid','far','lowhp','outnumbered'];
const IDLE_ACTIONS=['patrol','shadow','ambush'];
// Independent, value-based exploration policy. Neutral starting values and no distance reward.
const EXPLORE_ACTIONS=['hold','near','mid','wide'];
const EXPLORE_CONTEXTS=['early_calm','early_alert','late_calm','late_alert'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

// ECHO NEURAL: compact, dependency-free contextual value model (8 -> 8 -> 5).
// All brains use the same architecture and symmetric zero-output initialization.
const NN_INPUT=8, NN_HIDDEN=8, NN_OUTPUT=5, NN_SCALE=.38;
function freshNetwork(){
 const w1=Array.from({length:NN_HIDDEN},(_,h)=>Array.from({length:NN_INPUT},(_,i)=>Math.sin((h+1)*17.91+(i+1)*8.37)*.12));
 return{w1,b1:Array(NN_HIDDEN).fill(0),w2:Array.from({length:NN_OUTPUT},()=>Array(NN_HIDDEN).fill(0)),b2:Array(NN_OUTPUT).fill(0),updates:0};
}
function validNetwork(n){return !!(n&&Array.isArray(n.w1)&&n.w1.length===NN_HIDDEN&&n.w1.every(r=>Array.isArray(r)&&r.length===NN_INPUT&&r.every(x=>Number.isFinite(x)&&Math.abs(x)<=10))&&Array.isArray(n.w2)&&n.w2.length===NN_OUTPUT&&n.w2.every(r=>Array.isArray(r)&&r.length===NN_HIDDEN&&r.every(x=>Number.isFinite(x)&&Math.abs(x)<=10))&&Array.isArray(n.b1)&&n.b1.length===NN_HIDDEN&&n.b1.every(x=>Number.isFinite(x)&&Math.abs(x)<=10)&&Array.isArray(n.b2)&&n.b2.length===NN_OUTPUT&&n.b2.every(x=>Number.isFinite(x)&&Math.abs(x)<=10)&&Number.isSafeInteger(n.updates)&&n.updates>=0);}
function neuralFeatures(entity,context,distance,visibleCount){
 const x=CONTEXTS.map(c=>c===context?1:0);
 x.push(clamp((entity?.hp??100)/100,0,1),clamp(distance/100,0,1),clamp(visibleCount/5,0,1));return x;
}
function neuralForward(n,x){const hidden=n.w1.map((w,h)=>Math.tanh(n.b1[h]+w.reduce((sum,v,i)=>sum+v*x[i],0)));
 const out=n.w2.map((w,a)=>n.b2[a]+w.reduce((sum,v,h)=>sum+v*hidden[h],0));return{hidden,out};}
function neuralLearn(b,d,reward,decay){
 if(!Array.isArray(d.features)||d.features.length!==NN_INPUT||!d.features.every(Number.isFinite))return;
 const ai=ACTIONS.indexOf(d.action);if(ai<0)return;
 const n=b.neural,{hidden,out}=neuralForward(n,d.features),err=clamp(reward,-3,3)-out[ai];
 const rate=.012*decay,oldW=n.w2[ai].slice();
 for(let h=0;h<NN_HIDDEN;h++)n.w2[ai][h]=clamp(n.w2[ai][h]+rate*err*hidden[h],-3,3);
 n.b2[ai]=clamp(n.b2[ai]+rate*err,-3,3);
 for(let h=0;h<NN_HIDDEN;h++){const grad=rate*err*oldW[h]*(1-hidden[h]*hidden[h]);
  for(let i=0;i<NN_INPUT;i++)n.w1[h][i]=clamp(n.w1[h][i]+grad*d.features[i],-3,3);
  n.b1[h]=clamp(n.b1[h]+grad,-3,3);
 }n.updates++;
}
// ECHO HYPOTHESES: all 20 brains begin with neutral, identical evidence.
// These are conditional predictions, not assigned ideologies or character classes.
const BELIEF_INFLUENCE=.22, BELIEF_MIN_SAMPLES=2, BELIEF_LOG_LIMIT=32;
function freshHypotheses(){const states={};for(const context of CONTEXTS){states[context]={};for(const action of ACTIONS)states[context][action]={estimate:0,evidence:0}}return{states,revisions:[],updates:0}}
function validHypotheses(h){return !!(h&&h.states&&CONTEXTS.every(c=>h.states[c]&&ACTIONS.every(a=>{const x=h.states[c][a];return x&&Number.isFinite(x.estimate)&&Math.abs(x.estimate)<=3&&Number.isFinite(x.evidence)&&x.evidence>=0&&x.evidence<=1e9}))&&Array.isArray(h.revisions)&&h.revisions.length<=BELIEF_LOG_LIMIT&&Number.isSafeInteger(h.updates)&&h.updates>=0)}
function strongestHypothesis(h,context){let best=null;for(const action of ACTIONS){const v=h.states[context][action];if(v.evidence<BELIEF_MIN_SAMPLES)continue;if(!best||v.estimate>best.estimate)best={action,estimate:v.estimate,evidence:v.evidence}}return best}
function updateHypothesis(b,d,reward,decay){
 if(!b.hypotheses?.states?.[d.context]?.[d.action])return;
 const h=b.hypotheses,old=strongestHypothesis(h,d.context),item=h.states[d.context][d.action];
 const weight=Math.min(1,Math.max(0,decay)),target=clamp(reward,-3,3);
 item.estimate=clamp(item.estimate+.065*weight*(target-item.estimate),-3,3);
 item.evidence=Math.min(1e9,item.evidence+weight);h.updates++;
 const current=strongestHypothesis(h,d.context);
 if(old&&current&&old.action!==current.action){h.revisions.push({match:activeMatchNumber,context:d.context,from:old.action,to:current.action});h.revisions=h.revisions.slice(-BELIEF_LOG_LIMIT)}
}
function relation(){return{trust:0,hostility:0,cooperation:0,threat:0,encounters:0,assists:0,betrayals:0}}
// The player is an ordinary observed opponent, not a permanently designated boss.
// Keep the relation separate from AI-to-AI slots, but evaluate it by the same formula.
function freshPlayerRelation(){return {...relation(),damageReceived:0,damageDealt:0,defeatedBy:0,defeatedPlayer:0,sharedFights:0}}
const PLAYER_REL_KEYS=['trust','hostility','cooperation','threat','encounters','assists','betrayals','damageReceived','damageDealt','defeatedBy','defeatedPlayer','sharedFights'];
function normalizePlayerRelation(raw){
 const r=freshPlayerRelation();if(!raw||typeof raw!=='object')return r;
 for(const k of PLAYER_REL_KEYS){const n=raw[k];if(Number.isFinite(n)&&n>=0&&['encounters','assists','betrayals','damageReceived','damageDealt','defeatedBy','defeatedPlayer','sharedFights'].includes(k))r[k]=Math.min(n,1e7);else if(Number.isFinite(n)&&['trust','hostility','cooperation','threat'].includes(k))r[k]=clamp(n,-2.5,2.5)}
 return r;
}
function adjustPlayerRelation(b,delta){const r=b?.playerRelation;if(!r)return;
 for(const [k,v] of Object.entries(delta)){if(!Number.isFinite(v)||!(k in r))continue;
  if(['trust','hostility','cooperation','threat'].includes(k))r[k]=clamp(r[k]+v,k==='threat'?0:-2.5,2.5);
  else r[k]=clamp(r[k]+Math.max(0,v),0,1e7);
 }
 // Legacy field stays readable for old integrations but is never used in decisions.
 b.playerThreat=r.threat;
}
function relationConfidence(r){return clamp((r?.encounters||0)/((r?.encounters||0)+1.5),0,1)}
function relationScore(r,finalPressure=0,confidence=1){
 // Threat means danger: it should NOT automatically make someone a priority target.
 return confidence*(r.hostility*.78-r.threat*.30-r.trust*(1.05-finalPressure*.82)-r.cooperation*(.72-finalPressure*.58));
}
function decayPlayerRelation(b){const r=b.playerRelation;if(!r)return;
 r.trust*=.975;r.hostility*=.970;r.cooperation*=.975;r.threat*=.970;
 // An observation becomes less decisive over time, even without new encounters.
 r.encounters*=.975;b.playerThreat=r.threat;
}
function seededNoise(id,n){let x=Math.sin((id+1)*91.733+(n+1)*37.119)*43758.5453;return(x-Math.floor(x))*2-1}
function freshExplore(){const q={};for(const c of EXPLORE_CONTEXTS){q[c]={};for(const a of EXPLORE_ACTIONS)q[c][a]=0}return{q,counts:Object.fromEntries(EXPLORE_ACTIONS.map(a=>[a,0])),updates:0}}
function normalizeExplore(raw){const fresh=freshExplore();if(!raw||typeof raw!=='object')return fresh;for(const c of EXPLORE_CONTEXTS)for(const a of EXPLORE_ACTIONS){const v=raw.q?.[c]?.[a];if(Number.isFinite(v)&&Math.abs(v)<=3)fresh.q[c][a]=v}for(const a of EXPLORE_ACTIONS){const n=raw.counts?.[a];if(Number.isSafeInteger(n)&&n>=0)fresh.counts[a]=n}fresh.updates=Number.isSafeInteger(raw.updates)&&raw.updates>=0?raw.updates:0;return fresh}
const COVER_CHOICES=['usual','cover_wait'];
const COVER_FOLLOWUPS=['wait','reload','leave'];
function normalizeCoverPatterns(raw,choices=COVER_CHOICES){
 const patterns={};
 for(const context of ['lowhp','healthy']){
  patterns[context]={};
  for(const choice of choices){
   const entry=raw?.[context]?.[choice];
   patterns[context][choice]={
    count:Number.isSafeInteger(entry?.count)&&entry.count>0?entry.count:0,
    value:Number.isFinite(entry?.value)?clamp(entry.value,-3,3):0
   };
  }
 }
 return patterns;
}
function beginCoverTrial(entity,now,target=null){
 const brain=brainOf(entity),session=sessionOf(entity);
 if(!active||!brain||!session||session.coverTrial)return null;
 const context=entity.hp<34?'lowhp':'healthy', values=brain.coverPatterns[context];
 const choice=weightedChoice(COVER_CHOICES.map(key=>({key,value:values[key].value})));
 session.coverTrial={context,choice,target,until:now+8,extended:false,dealt:session.damageDealt,taken:session.damageTaken};
 return choice;
}
function coverTrialFired(entity,target,now){
 const trial=sessionOf(entity)?.coverTrial;
 if(!trial||trial.extended||trial.target!==target||now>=trial.until)return;
 trial.until=now+24;
 trial.extended=true;
}
function chooseCoverFollowup(entity,canReload){
 const session=sessionOf(entity),trial=session?.coverTrial;
 if(!trial)return 'wait';
 const values=brainOf(entity).coverFollowups[trial.context];
 const choice=weightedChoice(COVER_FOLLOWUPS.filter(key=>key!=='reload'||canReload)
  .map(key=>({key,value:values[key].value})));
 trial.followup={choice,dealt:session.damageDealt,taken:session.damageTaken};
 return choice;
}
function scoreCoverChoice(entity,session,baseline,entry){
 const score=clamp((session.damageDealt-baseline.dealt-session.damageTaken+baseline.taken)/100-(entity.alive?0:1),-3,3);
 entry.count++;
 entry.value+=(score-entry.value)/Math.min(entry.count,12);
 return score;
}
function settleCoverTrial(entity,now){
 const session=sessionOf(entity),trial=session?.coverTrial;
 if(!trial||(entity.alive&&now<trial.until))return null;
 const brain=brainOf(entity);
 const score=scoreCoverChoice(entity,session,trial,brain.coverPatterns[trial.context][trial.choice]);
 const branch=trial.followup;
 const branchScore=branch?scoreCoverChoice(entity,session,branch,brain.coverFollowups[trial.context][branch.choice]):null;
 session.coverTrial=null;
 return {choice:trial.choice,score,branch:branch?.choice,branchScore};
}
function makeBrain(id){
 const q={},idle={};let n=0;
 for(const c of CONTEXTS){q[c]={};for(const a of ACTIONS)q[c][a]=seededNoise(id,n++)*.055}
 for(const a of IDLE_ACTIONS)idle[a]=seededNoise(id,n++)*.05;
 return{id,games:0,kills:0,playerKills:0,deaths:0,survivals:0,wins:0,totalSurvival:0,damageDealt:0,damageTaken:0,playerThreat:0,playerRelation:freshPlayerRelation(),q,idle,explore:freshExplore(),neural:freshNetwork(),hypotheses:freshHypotheses(),coverPatterns:normalizeCoverPatterns(),coverFollowups:normalizeCoverPatterns(null,COVER_FOLLOWUPS),weapons:{},relations:Array.from({length:BRAIN_COUNT},()=>relation()),history:[]}
}
function fresh(){return{version:VERSION,matches:0,createdAt:Date.now(),updatedAt:Date.now(),brains:Array.from({length:BRAIN_COUNT},(_,i)=>makeBrain(i))}}
function normalizeBrain(raw,id){
 const b=Object.assign(makeBrain(id),raw||{});b.id=id;
 for(const c of CONTEXTS){b.q[c]=Object.assign(makeBrain(id).q[c],b.q?.[c]||{})}
 b.idle=Object.assign(makeBrain(id).idle,b.idle||{});
 // Legacy 'playerThreat' could saturate at 2.5 regardless of experience. Do NOT
 // convert that invalid accumulated value into the new player relation.
 b.playerRelation=normalizePlayerRelation(b.playerRelation);b.playerThreat=b.playerRelation.threat;
 b.coverPatterns=normalizeCoverPatterns(b.coverPatterns);b.coverFollowups=normalizeCoverPatterns(b.coverFollowups,COVER_FOLLOWUPS);b.explore=normalizeExplore(b.explore);b.neural=validNetwork(b.neural)?b.neural:freshNetwork();b.hypotheses=validHypotheses(b.hypotheses)?b.hypotheses:freshHypotheses();b.weapons=b.weapons||{};
 b.relations=Array.from({length:BRAIN_COUNT},(_,i)=>Object.assign(relation(),b.relations?.[i]||{}));
 b.history=Array.isArray(b.history)?b.history.slice(-12):[];return b
}
function load(){
 try{let raw=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(!raw||raw.version!==VERSION)return fresh();raw.brains=Array.from({length:BRAIN_COUNT},(_,i)=>normalizeBrain(raw.brains?.[i],i));return raw}catch(e){return fresh()}
}
let memory=load(),active=false,matchElapsed=0,activeMatchNumber=0,matchDuration=1200,roster=[],sessions=new Map(),lastSocialPulse=0;
function save(){memory.updatedAt=Date.now();try{localStorage.setItem(STORAGE_KEY,JSON.stringify(memory))}catch(e){}}
function shuffledBrains(count){let a=Array.from({length:BRAIN_COUNT},(_,i)=>i);for(let i=a.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a.slice(0,count)}
function makeSession(brainId){return{brainId,decisions:[],idleDecisions:[],damageDealt:0,damageTaken:0,kills:0,playerKills:0,pickups:[],social:{},playerCoopAt:-1e6,diedAt:null,killedBy:null,lastAction:'patrol',lastContext:'mid',exploreEpisodes:[],exploreCurrent:null}}
function beginMatch(count=MATCH_ROSTER_SIZE,duration=1200){
 roster=shuffledBrains(Math.min(MATCH_ROSTER_SIZE,Math.max(1,count)));sessions=new Map();for(const id of roster)sessions.set(id,makeSession(id));active=true;activeMatchNumber=memory.matches+1;matchElapsed=0;matchDuration=duration;lastSocialPulse=0;return roster.slice()
}
function setMatchElapsed(seconds){if(active&&Number.isFinite(seconds))matchElapsed=clamp(seconds,0,matchDuration)}
function brainOf(entity){return entity&&Number.isInteger(entity.brainId)?memory.brains[entity.brainId]:null}
function sessionOf(entity){return entity&&Number.isInteger(entity.brainId)?sessions.get(entity.brainId):null}
function contextFor(entity,distance,visibleCount=1){if(entity.hp<34)return'lowhp';if(visibleCount>=3)return'outnumbered';if(distance<12)return'close';if(distance>38)return'far';return'mid'}
function weightedChoice(values,temperature=.68){
 if(Math.random()<.11)return values[Math.floor(Math.random()*values.length)].key;
 let max=Math.max(...values.map(v=>v.value)),weights=values.map(v=>Math.exp((v.value-max)/temperature)),sum=weights.reduce((a,b)=>a+b,0),r=Math.random()*sum;
 for(let i=0;i<values.length;i++){r-=weights[i];if(r<=0)return values[i].key}return values[values.length-1].key
}
function rememberDecision(entity,context,action,target,features){
 let s=sessionOf(entity);if(!s)return;s.lastAction=action;s.lastContext=context;
 s.decisions.push({context,action,features,target:target?.brainId??(target?.isPlayer?'player':null),time:performance.now()/1000});if(s.decisions.length>72)s.decisions.shift()
}
function chooseCombat(entity,distance,visibleCount,target){
 let b=brainOf(entity);if(!b)return{context:'mid',action:'strafe',duration:3};let context=contextFor(entity,distance,visibleCount),features=neuralFeatures(entity,context,distance,visibleCount),prediction=neuralForward(b.neural,features).out,scores=ACTIONS.map((action,i)=>({key:action,value:b.q[context][action]+NN_SCALE*clamp(prediction[i],-3,3)+BELIEF_INFLUENCE*clamp(b.hypotheses.states[context][action].estimate,-3,3)*Math.min(1,b.hypotheses.states[context][action].evidence/3)+seededNoise(b.id,b.games+i)*Math.max(0,.035-b.games*.001)})),action=weightedChoice(scores);
 rememberDecision(entity,context,action,target,features);return{context,action,duration:2.2+Math.random()*2.8}
}
function updateRecent(entity,reward,depth=9){
 let b=brainOf(entity),s=sessionOf(entity);if(!b||!s)return;let recent=s.decisions.slice(-depth),decay=1;
 for(let i=recent.length-1;i>=0;i--){let d=recent[i],old=b.q[d.context]?.[d.action];if(Number.isFinite(old)){let alpha=.07*Math.min(1,decay);b.q[d.context][d.action]=clamp(old+alpha*(reward-old),-3,3);neuralLearn(b,d,reward,decay);updateHypothesis(b,d,reward,decay)}decay*=.78}
}
// High-level route policy, independent of the existing idle strategy and combat controller.
// An exploration choice is held long enough to make progress; it is not reset
// by the frequent 3-6 second idle-strategy reconsideration.
function exploreContext(entity,progress){
 const late=progress>=.5?'late':'early';
 const alert=entity.awareness!=='calm'&&entity.awareness!==undefined||entity.hp<60||
   (entity.lastSeen&&Number.isFinite(entity.lastSeen.at)&&Number.isFinite(entity.exploreNow)&&entity.exploreNow-entity.lastSeen.at<12);
 return late+'_'+(alert?'alert':'calm');
}
function chooseExplore(entity,progress,now){
 const b=brainOf(entity),ss=sessionOf(entity);if(!b||!ss)return'near';
 entity.exploreNow=now;
 if(entity.exploreMode&&Number.isFinite(entity.exploreUntil)&&now<entity.exploreUntil)return entity.exploreMode;
 if(ss.exploreCurrent){ss.exploreCurrent.end=matchElapsed;ss.exploreEpisodes.push(ss.exploreCurrent);ss.exploreCurrent=null}
 const context=exploreContext(entity,progress);
 const scores=EXPLORE_ACTIONS.map(a=>({key:a,value:b.explore.q[context][a]}));
 const action=weightedChoice(scores,.60); // Same neutral exploration for every brain.
 entity.exploreMode=action;entity.exploreContext=context;
 entity.exploreUntil=now+(action==='wide'?155:action==='mid'?118:action==='hold'?65:90);
 entity.exploreDecisionCount=(entity.exploreDecisionCount||0)+1;
 ss.exploreCurrent={context,action,start:matchElapsed,end:matchElapsed,feedback:0};
 b.explore.counts[action]++;return action;
}
function exploreFeedback(entity,signal){
 const ss=sessionOf(entity);if(ss?.exploreCurrent&&Number.isFinite(signal))
  ss.exploreCurrent.feedback=clamp(ss.exploreCurrent.feedback+signal,-2,2);
}
function finishExplore(entity,session,terminal){
 const b=brainOf(entity);if(!b||!session)return;
 if(session.exploreCurrent){session.exploreCurrent.end=matchElapsed;session.exploreEpisodes.push(session.exploreCurrent);session.exploreCurrent=null}
 const episodes=session.exploreEpisodes;if(!episodes.length)return;
 // Recent experiences retain more credit for the terminal outcome; feedback
 // is based only on actual damage, deaths and kills, never distance or travel.
 const last=episodes.length-1;
 for(let i=0;i<episodes.length;i++){const ep=episodes[i],old=b.explore.q[ep.context]?.[ep.action];if(!Number.isFinite(old))continue;
  const decay=Math.pow(.89,last-i),target=clamp(ep.feedback+(terminal===null?0:terminal*.6*decay),-3,3);
  const alpha=.065*(.35+.65*decay);
  b.explore.q[ep.context][ep.action]=clamp(old+alpha*(target-old),-3,3);b.explore.updates++;
 }
}
function weaponStat(b,wid){return b.weapons[wid]||(b.weapons[wid]={uses:0,damage:0,kills:0,value:0})}
function weaponPreference(entity,wid){let b=brainOf(entity);if(!b)return 0;return clamp(weaponStat(b,wid).value,-1.5,1.5)}
function onPickup(entity,wid){let b=brainOf(entity),s=sessionOf(entity);if(!b||!s)return;weaponStat(b,wid).uses++;s.pickups.push(wid)}
function targetKey(t){return t?.isPlayer?'player':Number.isInteger(t?.brainId)?'brain:'+t.brainId:null}
function evidenceInterest(actor,target){let b=brainOf(actor);if(!b||!target)return 0;if(target.isPlayer){let r=b.playerRelation;return clamp((r.hostility*.55+r.threat*.3-r.trust*.36-r.cooperation*.25)*relationConfidence(r),-.6,.8)}if(Number.isInteger(target.brainId)){let r=b.relations[target.brainId];return clamp(r.hostility*.55+r.threat*.3-r.trust*.36-r.cooperation*.25,-.6,.8)}return 0}
function investigationBias(actor,source){let b=brainOf(actor);if(!b)return 0;let aggressive=0,cautious=0;for(const c of CONTEXTS){aggressive+=b.q[c].rush+b.q[c].flank+b.q[c].strafe*.35;cautious+=b.q[c].retreat+b.q[c].hold*.55}let bias=(aggressive-cautious)/(CONTEXTS.length*3);bias+=(b.idle.patrol-b.idle.ambush*.35)*.22;if(source==='pickup')bias+=b.idle.ambush*.16;return clamp(bias,-1,1)}
function pickTarget(actor,candidates,aliveCount){
 const b=brainOf(actor);if(!b||!candidates.length)return candidates[0]?.entity||null;
 const finalPressure=clamp((4-aliveCount)/3,0,1),ranked=[];
 for(const c of candidates){const t=c.entity,r=c.isPlayer?b.playerRelation:b.relations[t.brainId];
  if(!r)continue;
  const confidence=c.isPlayer?relationConfidence(r):1;
  const score=1.25-c.distance/86+(1-clamp((t.hp||100)/100,0,1))*.32+Math.random()*.13+relationScore(r,finalPressure,confidence);
  ranked.push({t,score,r,confidence});
 }
 if(!ranked.length)return null;
 ranked.sort((a,z)=>z.score-a.score);const best=ranked[0];
 // Apply the SAME cooperation/trust rule whether the target is human or AI.
 const affinity=(best.r.trust+best.r.cooperation)*best.confidence;
 if(affinity>.38&&finalPressure<.65){
  const alternative=ranked.find(x=>x!==best&&x.score>best.score-.24);
  if(alternative)return alternative.t;
  if(Math.random()<clamp(affinity*.34,0,.62))return null;
 }
 return best.t;
}
function adjustRelation(fromId,toId,delta){
 if(!Number.isInteger(fromId)||!Number.isInteger(toId)||fromId===toId)return;let r=memory.brains[fromId].relations[toId];
 for(const [k,v] of Object.entries(delta))if(k in r)r[k]=clamp(r[k]+v,-2.5,2.5)
}
function onDamage(attacker,victim,damage,wid){
 if(!active||!victim?.alive)return;let amount=Math.max(0,damage||0),ab=brainOf(attacker),vb=brainOf(victim),as=sessionOf(attacker),vs=sessionOf(victim);
 if(ab&&as){as.damageDealt+=amount;ab.damageDealt+=amount;let ws=weaponStat(ab,wid||attacker.wid||'unknown');ws.damage+=amount;ws.value=clamp(ws.value+amount*.0007,-1.5,1.5);updateRecent(attacker,clamp(amount/55,0,.9),4);exploreFeedback(attacker,clamp(amount/200,0,.45))}
 if(vb&&vs){vs.damageTaken+=amount;vb.damageTaken+=amount;updateRecent(victim,-clamp(amount/70,0,.7),4);exploreFeedback(victim,-clamp(amount/200,0,.45))}
 if(ab&&vb){adjustRelation(victim.brainId,attacker.brainId,{trust:-amount*.006,hostility:amount*.008,threat:amount*.004,encounters:.02});adjustRelation(attacker.brainId,victim.brainId,{hostility:amount*.002,encounters:.01})}
 // Direct experience: receiving damage raises danger and hostility; dealing damage
 // provides evidence of the player's vulnerability, not of their aggression.
 if(attacker?.isPlayer&&vb)adjustPlayerRelation(vb,{trust:-amount*.006,hostility:amount*.008,threat:amount*.004,encounters:Math.max(.025,amount*.003),damageReceived:amount});
 if(victim?.isPlayer&&ab)adjustPlayerRelation(ab,{threat:-amount*.0018,encounters:Math.max(.025,amount*.002),damageDealt:amount});
 // Shared target provides *weak evidence* of cooperation, not a forced alliance.
 if(attacker?.isPlayer&&Number.isInteger(victim?.brainId)){
  for(const [id,s] of sessions){if(id===victim.brainId||matchElapsed-s.playerCoopAt<12)continue;
   const ally=globalThis.__lastSignalEnemies?.find(e=>e.brainId===id&&e.alive);
   if(!ally||ally.lastTargetKey!==targetKey(victim)||Math.hypot(ally.x-victim.x,ally.z-victim.z)>45)continue;
   adjustPlayerRelation(memory.brains[id],{trust:.055,cooperation:.08,encounters:.15,sharedFights:1});s.playerCoopAt=matchElapsed;
  }
 }
}
function onKill(attacker,victim,enemies){
 if(!active)return;let as=sessionOf(attacker),vs=sessionOf(victim),ab=brainOf(attacker),vb=brainOf(victim),now=matchElapsed;
 if(ab&&as){as.kills++;ab.kills++;if(victim?.isPlayer){as.playerKills++;ab.playerKills++;adjustPlayerRelation(ab,{threat:-.14,encounters:.25,defeatedPlayer:1})}let ws=weaponStat(ab,attacker.wid||'unknown');ws.kills++;ws.value=clamp(ws.value+.14,-1.5,1.5);updateRecent(attacker,2.6,12);exploreFeedback(attacker,.85)}
 if(vb&&vs){vs.diedAt=now;vs.killedBy=attacker?.isPlayer?'player':attacker?.brainId??'environment';updateRecent(victim,-2.8,14);exploreFeedback(victim,-1.0)}
 if(ab&&vb){adjustRelation(victim.brainId,attacker.brainId,{trust:-.3,hostility:.42,threat:.22,betrayals:.12});adjustRelation(attacker.brainId,victim.brainId,{hostility:.08,threat:.05})}
 if(attacker?.isPlayer&&vb)adjustPlayerRelation(vb,{hostility:.32,threat:.16,trust:-.16,encounters:.30,defeatedBy:1});
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
function chooseIdle(actor,partner){let b=brainOf(actor);if(!b)return'patrol';let values=IDLE_ACTIONS.map(key=>({key,value:b.idle[key]+(key==='shadow'&&!partner?-1.4:0)})),action=weightedChoice(values,.76),s=sessionOf(actor);if(s){s.lastAction=action;s.idleDecisions.push(action);if(s.idleDecisions.length>48)s.idleDecisions.shift()}return action}
function reinforceIdleTrajectory(entity,session,reward){
 const b=brainOf(entity);if(!b||!session?.idleDecisions?.length)return;
 // Attribute the outcome across choices made during the match, not only the last one.
 // Each idle strategy gets an update proportional to its share of observed choices.
 const count=session.idleDecisions.length;
 for(const action of IDLE_ACTIONS){
  const n=session.idleDecisions.filter(a=>a===action).length;
  if(!n||!Number.isFinite(b.idle[action]))continue;
  const alpha=.055*n/count;
  b.idle[action]=clamp(b.idle[action]+alpha*(reward*.55-b.idle[action]),-2,2);
 }
}
// Terminal outcomes are about winning, not merely lasting until the clock expires.
// Combat rewards (damage, kills and death) are still handled by their own events.
function terminalReward(won,survived,completion,reason){
 if(reason==='RETIRED')return null; // A manually abandoned experiment is not an outcome.
 if(won)return 3.0;
 if(survived)return 0; // Multiple survivors at time limit: a draw, not victory.
 return -.65+.20*completion; // Defeat stays negative; partial endurance is modest.
}
function finishMatch(reason,enemies,elapsed,playerAlive){
 if(!active)return;setMatchElapsed(elapsed);active=false;memory.matches++;let living=enemies.filter(e=>e.alive),winner=living.length===1&&!playerAlive?living[0]:null;
 for(const e of enemies){let b=brainOf(e),s=sessionOf(e);if(!b||!s)continue;b.games++;let survived=!!e.alive,won=e===winner,life=s.diedAt!==null?Math.max(0,s.diedAt):elapsed;b.totalSurvival+=life;if(!survived)b.deaths++;else{b.survivals++;if(won)b.wins++}
  let completion=clamp(life/Math.max(1,matchDuration),0,1),reward=terminalReward(won,survived,completion,reason);
  if(reward!==null){updateRecent(e,reward,18);reinforceIdleTrajectory(e,s,reward)}
  finishExplore(e,s,reward)
  for(const [otherId,seconds] of Object.entries(s.social)){let t=clamp(seconds/20,0,.28);adjustRelation(e.brainId,+otherId,{trust:t*.35,cooperation:t*.6,encounters:t*.5})}
  for(const r of b.relations){r.trust*=.992;r.hostility*=.994;r.cooperation*=.993;r.threat*=.995}
  decayPlayerRelation(b);
  b.history.push({match:memory.matches,survived,kills:s.kills,playerKills:s.playerKills,seconds:Math.round(life),lastAction:s.lastAction,at:Date.now()});b.history=b.history.slice(-12)
 }
 save();refreshDebug(enemies)
}
function bestEntry(obj){return Object.entries(obj||{}).sort((a,b)=>b[1]-a[1])[0]||['-',0]}
function strongestRelation(b){let best=null;for(let i=0;i<b.relations.length;i++){if(i===b.id)continue;let r=b.relations[i],score=r.trust+r.cooperation-r.hostility;if(!best||score>best.score)best={id:i,score,r}}return best}
function snapshot(){return{version:memory.version,matches:memory.matches,updatedAt:memory.updatedAt,brains:memory.brains.map(b=>{let combat=[];for(const c of CONTEXTS){let [action,value]=bestEntry(b.q[c]);combat.push({context:c,action,value})}let rel=strongestRelation(b),[idle,idleValue]=bestEntry(b.idle);return{id:b.id,games:b.games,kills:b.kills,playerKills:b.playerKills,deaths:b.deaths,survivals:b.survivals,wins:b.wins,averageSurvival:b.games?Math.round(b.totalSurvival/b.games):0,playerThreat:+b.playerRelation.threat.toFixed(2),playerRelation:{...b.playerRelation,confidence:+relationConfidence(b.playerRelation).toFixed(2)},neuralUpdates:b.neural.updates,hypothesisUpdates:b.hypotheses.updates,revisions:b.hypotheses.revisions.slice(-3),hypotheses:CONTEXTS.map(context=>({context,best:strongestHypothesis(b.hypotheses,context)})),idle,idleValue:+idleValue.toFixed(2),explore:{q:b.explore.q,counts:b.explore.counts,updates:b.explore.updates},combat,relation:rel?{brainId:rel.id,score:+rel.score.toFixed(2),trust:+rel.r.trust.toFixed(2),cooperation:+rel.r.cooperation.toFixed(2),hostility:+rel.r.hostility.toFixed(2)}:null,weapons:Object.entries(b.weapons).sort((a,z)=>z[1].value-a[1].value).slice(0,3)}})}}
function reset(){memory=fresh();save();refreshDebug([])}
function importData(input){
 if(active)throw Error('試合中は学習記憶を読み込めません。');
 let raw=typeof input==='string'?JSON.parse(input):input;
 if(!raw||raw.version!==VERSION||!Array.isArray(raw.brains)||raw.brains.length<1||raw.brains.length>BRAIN_COUNT||!Number.isSafeInteger(raw.matches)||raw.matches<0)throw Error('対応していないECHO MEMORYデータです。');
 for(let i=0;i<raw.brains.length;i++){
  const b=raw.brains[i];
  if(!b||b.id!==i||!b.q||!b.idle||!Array.isArray(b.relations))throw Error('個体データの構造が不正です: '+(i+1));
  for(const c of CONTEXTS)for(const a of ACTIONS)if(!Number.isFinite(b.q[c]?.[a])||Math.abs(b.q[c][a])>3)throw Error('不正な行動評価値です: '+(i+1));
  for(const a of IDLE_ACTIONS)if(!Number.isFinite(b.idle[a])||Math.abs(b.idle[a])>2)throw Error('不正な待機評価値です: '+(i+1));
  if(b.neural!==undefined&&!validNetwork(b.neural))throw Error('不正なニューラルネットワークです: '+(i+1));
  if(b.hypotheses!==undefined&&!validHypotheses(b.hypotheses))throw Error('不正な仮説データです: '+(i+1));
 }
 // Original remains unchanged if parsing or validation fails.
 const upgraded={...raw,brains:Array.from({length:BRAIN_COUNT},(_,i)=>normalizeBrain(raw.brains[i],i))};
 memory=upgraded;save();refreshDebug([]);return{imported:raw.brains.length,total:BRAIN_COUNT,matches:memory.matches};
}
function exportData(){return JSON.stringify(memory,null,2)}
function downloadMemoryJSON(filename){
 // Build and validate the complete backup before allowing an irreversible reset.
 const data=exportData(),parsed=JSON.parse(data);
 if(!Array.isArray(parsed.brains)||parsed.brains.length!==BRAIN_COUNT||!Number.isSafeInteger(parsed.matches))throw Error('バックアップの検証に失敗しました。');
 const blob=new Blob([data],{type:'application/json'});
 if(!blob.size)throw Error('空のバックアップを検出しました。');
 const url=URL.createObjectURL(blob),link=document.createElement('a');
 try{
  link.href=url;link.download=filename;link.style.display='none';
  document.body.appendChild(link);link.click();
 }finally{
  link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
 }
 // Browsers cannot confirm the file was saved. The user verifies before Yes.
 return filename;
}
function backupBeforeReset(){
 const d=new Date(),stamp=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('')+'-'+[d.getHours(),d.getMinutes(),d.getSeconds()].map(v=>String(v).padStart(2,'0')).join('');
 const filename='echo_memory_backup_before_reset_'+stamp+'.json';
 try{downloadMemoryJSON(filename)}catch(error){alert('バックアップを作成できなかったため、初期化を中止しました。\n'+error.message);return}
 if(confirm('AIの学習データを初期化しますか？\n\nバックアップJSONが保存されたことを確認してから「OK」を押してください。'))reset();
}

let debugRoot=null,adminGate=null,logoTapCount=0,logoTapAt=0;
function installAdminStyle(){
 if(document.getElementById('echoAdminStyle'))return;
 let style=document.createElement('style');style.id='echoAdminStyle'; style.textContent='#learningDebug{position:fixed;inset:2vh 2vw;z-index:1200;background:#07100ff5;color:#e9eee9;border:1px solid #ffb24a;padding:0;overflow:hidden;display:flex;flex-direction:column;min-width:0;min-height:0;max-height:96vh;max-height:96dvh;font:14px/1.5 system-ui,sans-serif}#learningDebug .researchToolbar{flex:0 0 auto;padding:12px clamp(12px,2vw,24px) 8px;border-bottom:1px solid #52645b;background:#101b18;box-shadow:0 4px 15px #0007;z-index:1}#learningDebug .researchToolbar h2{margin:0 0 10px}#learningDebug .researchActions{display:flex;flex-wrap:wrap;gap:7px;align-items:center}#learningDebug .researchActions button{margin:0;min-height:38px;touch-action:manipulation}#learningDebug [data-view]{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y;padding:12px clamp(12px,2vw,24px) max(24px,env(safe-area-inset-bottom))}#learningDebug [data-view] .brainCard{touch-action:pan-y}#learningDebug [data-view] summary{touch-action:pan-y}@media(max-width:600px){#learningDebug{inset:8px 8px max(8px,env(safe-area-inset-bottom));max-height:calc(100dvh - 16px)}#learningDebug .researchToolbar{padding:10px 12px 8px}#learningDebug .researchToolbar h2{font-size:16px;margin:0 0 8px}#learningDebug .researchActions{gap:6px}#learningDebug .researchActions button{font-size:12px;padding:7px 9px;min-height:38px}#learningDebug [data-view]{padding:10px 12px 24px}}#learningDebug.hidden,#learningGate.hidden{display:none}#learningDebug h2{color:#ffb24a;margin:0 0 12px}#learningDebug button,#learningGate button{margin:0 8px 12px 0;padding:8px 12px;background:#17231f;color:#fff;border:1px solid #52645b;border-radius:5px}#learningDebug .brainList{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,290px),1fr));gap:10px}#learningDebug .brainCard{border:1px solid #30433b;border-radius:8px;background:#0e1b18;min-width:0}#learningDebug .brainCard[open]{border-color:#e2a957}#learningDebug summary{cursor:pointer;list-style:none;padding:12px}#learningDebug summary::-webkit-details-marker{display:none}#learningDebug .brainTitle{font-weight:800;color:#ffca80;display:flex;justify-content:space-between;gap:6px}#learningDebug .brainSub{font-size:12px;color:#bdcfc4;margin-top:6px}#learningDebug .brainDetails{border-top:1px solid #30433b;padding:12px;font-size:12px;overflow-wrap:anywhere}#learningDebug .brainDetails p{margin:5px 0}#learningDebug .brainDetails table{width:100%;border-collapse:collapse;font-size:12px}#learningDebug .brainDetails th,#learningDebug .brainDetails td{padding:5px;border-bottom:1px solid #30433b;text-align:left}#learningDebug .statLine{display:flex;flex-wrap:wrap;gap:6px}#learningDebug .statLine span{background:#23352d;padding:2px 6px;border-radius:3px}#learningGate{position:fixed;inset:0;z-index:1250;display:grid;place-items:center;padding:18px;background:#020706c9;color:#e9eee9;font:13px/1.5 monospace}#learningGate .gateCard{width:min(390px,100%);border:1px solid #ffb24a;background:#07100ff5;padding:22px;box-shadow:0 24px 70px #000}#learningGate h2{margin:0 0 8px;color:#ffb24a}#learningGate p{color:#a9b1a7}#learningGate input{width:100%;height:46px;margin:8px 0 14px;padding:0 12px;background:#101b18;color:#fff;border:1px solid #52645b;font:800 1rem monospace;letter-spacing:.18em;outline:none}#learningGate input:focus{border-color:#ffb24a}#learningGate [data-error]{min-height:20px;margin:0;color:#ff7465}.adminTapTarget{touch-action:manipulation}#learningDebug .researchToolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:58px;padding:9px 14px;overflow:visible}#learningDebug .researchToolbar h2{font-size:clamp(14px,3.6vw,19px);line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0;min-width:0}#learningDebug .researchSubtitle{font-size:.68em;opacity:.72}#learningDebug .researchHeaderControls{display:flex;align-items:center;gap:7px;flex:none}#learningDebug .researchTools{position:relative}#learningDebug .researchTools>summary{list-style:none;cursor:pointer;border:1px solid #52645b;border-radius:6px;background:#17231f;color:#e9eee9;padding:9px 11px;font-size:13px;white-space:nowrap;min-height:40px;box-sizing:border-box;display:flex;align-items:center}#learningDebug .researchTools>summary::-webkit-details-marker{display:none}#learningDebug .researchTools[open]>summary{border-color:#ffb24a;color:#ffca80}#learningDebug .researchActions{position:absolute;right:0;top:calc(100% + 9px);z-index:4;width:min(240px,calc(100vw - 46px));display:grid;grid-template-columns:1fr;gap:5px;padding:12px;border-radius:9px;background:#14221e;border:1px solid #ffb24a;box-shadow:0 12px 35px #000c}#learningDebug .researchActions [hidden]{display:none!important}#learningDebug .researchActions button{width:100%;min-height:43px;text-align:left;margin:0;padding:9px 12px;font-size:13px}#learningDebug .researchDanger{border-top:1px solid #45554b;padding-top:8px;margin-top:5px}#learningDebug .researchDanger button{border-color:#925d4e;color:#ffc7bb}#learningDebug .researchClose{width:42px;height:42px;min-height:42px;display:flex;align-items:center;justify-content:center;font-size:25px;line-height:1;padding:0;margin:0;border-radius:7px}#learningDebug .researchToolbar .researchTools summary:focus-visible,#learningDebug .researchClose:focus-visible{outline:2px solid #ffb24a;outline-offset:2px}@media(max-width:600px){#learningDebug .researchToolbar{min-height:56px;padding:8px 10px}#learningDebug .researchToolbar h2{font-size:15px}#learningDebug .researchHeaderControls{gap:6px}#learningDebug .researchTools>summary{font-size:12px;padding:9px;min-height:40px}#learningDebug .researchClose{width:40px;height:40px;min-height:40px}}@media(max-width:390px){#learningDebug .researchSubtitle{display:none}}';document.head.appendChild(style)
}
function ensureDebug(){
 if(debugRoot)return;
 debugRoot=document.createElement('section');debugRoot.id='learningDebug';debugRoot.innerHTML='<div class="researchToolbar"><h2>ECHO MEMORY <span class="researchSubtitle">/ RESEARCH VIEW</span></h2><div class="researchHeaderControls"><details class="researchTools"><summary aria-label="研究ツールを開く">⚙ ツール</summary><div class="researchActions"><button data-a="developer" type="button" data-dev-link>◇ DEVELOPER LABへ</button><button data-a="export" type="button">JSON出力</button><button data-a="import" type="button">JSON読込</button><button data-a="movement" type="button">移動ログCSV</button><button data-a="tactics" type="button">戦術CSV</button><div class="researchDanger"><button data-a="reset" type="button">学習初期化</button></div></div></details><button class="researchClose" data-a="close" type="button" aria-label="研究画面を閉じる" title="閉じる">×</button></div></div><input data-import-file type="file" accept=".json,application/json" style="display:none"><div data-view></div>';document.body.appendChild(debugRoot);
 debugRoot.addEventListener('click',e=>{let a=e.target?.dataset?.a;if(a==='close'){debugRoot.classList.add('hidden');document.body.classList.remove('research-open');debugRoot.querySelector('.researchTools').open=false;}if(a==='developer'){
   // Only the title screen may open Developer Lab. Close the research modal first.
   const start=document.getElementById('start');
   if(start&&!start.classList.contains('hidden')){
    debugRoot.classList.add('hidden');
    document.body.classList.remove('research-open');
    debugRoot.querySelector('.researchTools').open=false;
    document.dispatchEvent(new Event('lastsignal:open-developer-lab'));
   }
  }
  if(a==='reset')backupBeforeReset();if(a==='movement')window.LSMovementAudit?.download();if(a==='tactics')window.LSMovementAudit?.downloadTactics();if(a==='import')debugRoot.querySelector('[data-import-file]').click();if(a==='export'){try{downloadMemoryJSON('echo_memory_export.json')}catch(error){alert('JSON出力に失敗しました。\n'+error.message)}}})

 const updateDeveloperNav=()=>{const title=document.getElementById('start');const link=debugRoot.querySelector('[data-dev-link]');if(link)link.hidden=!(title&&!title.classList.contains('hidden'));};
 const visibilityObserver=new MutationObserver(()=>{if(!debugRoot.classList.contains('hidden'))updateDeveloperNav();});
 visibilityObserver.observe(debugRoot,{attributes:true,attributeFilter:['class']});
 updateDeveloperNav();
 debugRoot.querySelector('[data-import-file]').addEventListener('change',async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{const input=await file.text();const data=JSON.parse(input);if(!confirm('学習記憶を上書きします。現在の記憶をJSON出力でバックアップしましたか？\n読み込む個体数: '+data?.brains?.length))return;const result=importData(data);alert(result.imported+'体の記憶を読み込みました。合計'+result.total+'体。');}
  catch(err){alert('読み込み失敗: '+err.message)}finally{e.target.value=''}
 });
}
function ensureAdminGate(){
 if(adminGate)return;
 adminGate=document.createElement('section');adminGate.id='learningGate';adminGate.className='hidden';adminGate.innerHTML='<form class="gateCard"><h2>RESEARCH ACCESS</h2><p>ECHO MEMORY 管理コードを入力してください。</p><input data-code type="password" maxlength="5" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="管理コード"><p data-error></p><button type="submit">開く</button><button type="button" data-cancel>キャンセル</button></form>';document.body.appendChild(adminGate);
 let form=adminGate.querySelector('form'),input=adminGate.querySelector('[data-code]'),error=adminGate.querySelector('[data-error]');
 form.addEventListener('submit',e=>{e.preventDefault();if(input.value.trim().toUpperCase()!=='ALICE'){error.textContent='コードが違います。';input.value='';input.focus();return}input.value='';error.textContent='';adminGate.classList.add('hidden');ensureDebug();debugRoot.classList.remove('hidden');document.body.classList.add('research-open');refreshDebug(window.__lastSignalEnemies||[])});
 adminGate.querySelector('[data-cancel]').addEventListener('click',()=>adminGate.classList.add('hidden'));
 adminGate.addEventListener('pointerdown',e=>{if(e.target===adminGate)adminGate.classList.add('hidden')})
}
function openAdminGate(){ensureAdminGate();let input=adminGate.querySelector('[data-code]');adminGate.querySelector('[data-error]').textContent='';input.value='';adminGate.classList.remove('hidden');setTimeout(()=>input.focus(),40)}
function initDebug(){
 if(typeof document==='undefined')return;installAdminStyle();ensureAdminGate();let logo=document.querySelector('#start .title');if(!logo)return;logo.classList.add('adminTapTarget');
 logo.addEventListener('pointerup',()=>{let now=performance.now();logoTapCount=now-logoTapAt>3000?1:logoTapCount+1;logoTapAt=now;if(logoTapCount>=5){logoTapCount=0;openAdminGate()}})
}
function refreshDebug(currentEnemies=[]){
 if(!debugRoot)return;
 const opened=new Set(Array.from(debugRoot.querySelectorAll('.brainCard[open]')).map(e=>e.dataset.id));
 const snap=snapshot(),mapping=new Map(currentEnemies.filter(e=>Number.isInteger(e.brainId)).map(e=>[e.brainId,{name:e.name,awareness:e.awareness||'calm',source:e.belief?.source||'-'}]));
 const cards=snap.brains.map(b=>{
  const best=b.combat.slice().sort((a,z)=>z.value-a.value)[0],r=b.relation,m=mapping.get(b.id),name='BRAIN-'+String(b.id+1).padStart(2,'0');
  const hypotheses=b.hypotheses.filter(h=>h.best).map(h=>`<tr><td>${h.context}</td><td>${h.best.action}</td><td>${h.best.estimate.toFixed(2)}</td><td>${h.best.evidence.toFixed(1)}</td></tr>`).join('');
  const changes=b.revisions.slice().reverse().map(v=>`<p>第${v.match}試合 / ${v.context}: ${v.from} → ${v.to}</p>`).join('')||'<p>まだ記録なし</p>';
  return `<details class="brainCard" data-id="${b.id}" ${opened.has(String(b.id))?'open':''}><summary><div class="brainTitle"><span>${name}</span><span>${b.games?b.games+'戦':'未出場'}</span></div><div class="brainSub">${m?.name||'待機中'} · ${b.kills}K / ${b.deaths}D / ${b.survivals}S</div><div class="brainSub">${best.context}:${best.action} ${best.value.toFixed(2)} · NN ${b.neuralUpdates}回</div></summary><div class="brainDetails"><p>現在知覚: ${m?m.awareness+' / '+m.source:'なし'}</p><p>平均生存: ${b.averageSurvival}秒 / 対人危険度: ${b.playerThreat}</p><p>対人関係: 敵対 ${b.playerRelation.hostility.toFixed(2)} / 信頼 ${b.playerRelation.trust.toFixed(2)} / 協力 ${b.playerRelation.cooperation.toFixed(2)} / 確信 ${b.playerRelation.confidence.toFixed(2)}</p><p>対人経験: 被ダメ ${Math.round(b.playerRelation.damageReceived)} / 与ダメ ${Math.round(b.playerRelation.damageDealt)} / 共闘 ${b.playerRelation.sharedFights}回</p><p>ニューラル更新: ${b.neuralUpdates} / 仮説更新: ${b.hypothesisUpdates}</p><p>探索学習更新: ${b.explore.updates}回 / 近場 ${b.explore.counts.near}・中距離 ${b.explore.counts.mid}・広域 ${b.explore.counts.wide}・現地維持 ${b.explore.counts.hold}</p><p>探索方針の価値（状況別）: ${Object.entries(b.explore.q).map(([c,q])=>c+' '+Object.entries(q).sort((a,z)=>z[1]-a[1])[0].join(':')).join(' / ')}</p><p>強い行動: ${best.context}:${best.action} ${best.value.toFixed(2)}</p><p>関係: ${r?'BRAIN-'+String(r.brainId+1).padStart(2,'0')+' '+r.score:'なし'}</p><strong>経験仮説</strong><table><thead><tr><th>状況</th><th>行動</th><th>推定</th><th>証拠</th></tr></thead><tbody>${hypotheses||'<tr><td colspan="4">未確立</td></tr>'}</tbody></table><strong>最近の仮説変更</strong>${changes}</div></details>`
 }).join('');
 debugRoot.querySelector('[data-view]').innerHTML='<p>登録 '+snap.brains.length+'体 / 毎試合10体抽選 / 累計 '+snap.matches+' 試合</p><p>個体をタップすると学習の詳細を表示します。</p><div class="brainList">'+cards+'</div>';
 const mv=window.LSMovementAudit?.html();if(mv)debugRoot.querySelector('[data-view]').insertAdjacentHTML('afterbegin',mv);
}
if(typeof document!=='undefined'){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initDebug);else initDebug()}
window.LSLearning={beginCoverTrial,coverTrialFired,chooseCoverFollowup,settleCoverTrial,beginMatch,setMatchElapsed,brainOf,sessionOf,chooseCombat,pickTarget,pickPartner,chooseIdle,chooseExplore,rememberDecision,weaponPreference,evidenceInterest,investigationBias,onPickup,onDamage,onKill,socialPulse,finishMatch,snapshot,reset,exportData,importData,refreshDebug,targetKey,_memory:()=>memory};
})();
