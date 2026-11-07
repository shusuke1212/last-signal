/* LAST SIGNAL movement observation only. Never affects AI action or learning. */
(()=>{'use strict';
let current=null,history=[],serial=0;
const TACTICS_MATCH_LIMIT=20;
const tacticsHistory=[];
const checkpoints=[300,600,900,1200];
const pos=e=>e&&Number.isFinite(e.x)&&Number.isFinite(e.z)?{x:e.x,z:e.z}:null;
function location(p,settlements){if(!p||!settlements?.length)return {name:'',distance:null,near:false};const sorted=settlements.map(s=>({name:s.name,distance:Math.hypot(p.x-s.x,p.z-s.z)})).sort((a,b)=>a.distance-b.distance);return {...sorted[0],near:sorted[0].distance<=60}}
function recordPosition(r,e){const p=pos(e);if(p)r.lastPos=p;r.alive=!!e.alive;for(const t of checkpoints){if(r.seconds+0.03>=t&&!r.checkpoints[t]&&e.alive&&p)r.checkpoints[t]={...p}}}
function register(actors,settlements){if(!current)return;current.settlements=(settlements||[]).filter(s=>Number.isFinite(s.x)&&Number.isFinite(s.z)).map(s=>({name:s.name,x:s.x,z:s.z}));for(const e of actors){const r=row(e);if(!r)continue;const p=pos(e);if(p){r.startPos=p;r.lastPos=p}r.alive=!!e.alive}}

const make=e=>({brainId:e.brainId,name:e.name,role:e.isPlayer?'PLAYER':'AI',alive:true,seconds:0,noCommand:0,commanded:0,blocked:0,partial:0,travel:0,commands:0,goals:0,arrivals:0,expired:0,interrupted:0,goal:null,frameIntent:0,frameActual:0,nearPlayerSeconds:0,playerWithinSightSeconds:0,enemyNearSeconds:0,shots:0,hits:0,kills:0,crouchedSeconds:0,combatSeconds:0,explorePolicy:"",exploreContext:"",exploreDecisions:0,startPos:null,lastPos:null,checkpoints:{}});
function row(e){if(!current)return null;const id=e.isPlayer?'player':'ai:'+e.brainId;let r=current.rows.get(id);if(!r){r=make(e);current.rows.set(id,r)}return r}
function closeGoal(r,reason){if(!r?.goal)return;const g=r.goal;r.goal=null;if(g.arrived)r.arrivals++;else if(reason==='expired')r.expired++;else r.interrupted++}
function start(){if(current)finish('restarted');current={id:++serial,rows:new Map(),at:Date.now(),reason:'playing',tacticsEvents:[]};}
function beginFrame(e){const r=row(e);if(r){r.frameIntent=0;r.frameActual=0}}
function move(e,intended,actual){const r=row(e);if(!r||!Number.isFinite(intended)||intended<0)return;r.frameIntent+=intended;r.frameActual+=Number.isFinite(actual)?actual:0;r.commands++}
function goal(e,kind,x,z,now){const r=row(e);if(!r)return;closeGoal(r,'interrupted');r.goals++;r.goal={kind,x,z,started:now,until:e.routeUntil||now+45,arrived:false}}
function playerFrame(e,dt,intended,actual,nearby,stats){
 if(!current||!e?.alive)return;
 const r=row(e);r.seconds+=dt;r.alive=e.alive;r.travel+=actual;recordPosition(r,e);
 if(intended>.005){r.commanded+=dt;r.commands++;if(actual<intended*.35)r.blocked+=dt;else if(actual<intended*.8)r.partial+=dt}
 else r.noCommand+=dt;
 if(nearby<100)r.enemyNearSeconds+=dt;
 if(e.crouched)r.crouchedSeconds+=dt;
 if(stats){r.shots=stats.shots;r.hits=stats.hits;r.kills=stats.kills;}
}
function endFrame(e,dt,now){const r=row(e);if(!r)return;r.seconds+=dt;r.alive=e.alive;r.explorePolicy=e.exploreMode||"";r.exploreContext=e.exploreContext||"";r.exploreDecisions=e.exploreDecisionCount||0;
 if(typeof window!=='undefined'&&window.__lastSignalAuditPlayer?.alive){const p=window.__lastSignalAuditPlayer,d=Math.hypot(e.x-p.x,e.z-p.z);if(d<100)r.nearPlayerSeconds+=dt;if(d<78)r.playerWithinSightSeconds+=dt}
 const wanted=r.frameIntent,achieved=r.frameActual;r.travel+=achieved;recordPosition(r,e);if(wanted>.005){r.commanded+=dt;if(achieved<wanted*.35)r.blocked+=dt;else if(achieved<wanted*.8)r.partial+=dt}else r.noCommand+=dt;if(r.goal){const g=r.goal;if(Math.hypot(e.x-g.x,e.z-g.z)<5){g.arrived=true;closeGoal(r,'arrived')}else if(now>=g.until){closeGoal(r,'expired')}}}
function tacticsEvent(event){current?.tacticsEvents.push(event)}
function finish(reason,actors){
 if(!current)return;
 if(actors)for(const e of actors){const r=row(e);if(r)recordPosition(r,e)}
 current.reason=reason;
 history.push(extract(current));
 if(history.length>30)history.shift();
 if(current.tacticsEvents.length){
  tacticsHistory.push({id:current.id,reason,tacticsEvents:current.tacticsEvents});
  if(tacticsHistory.length>TACTICS_MATCH_LIMIT)tacticsHistory.shift();
 }
 current=null;
}
function extract(run){return {id:run.id,reason:run.reason,at:run.at,settlements:(run.settlements||[]).map(s=>({...s})),rows:[...run.rows.values()].map(r=>({...r,goal:r.goal?{...r.goal}:null}))}}
function latest(){return current?extract(current):history.at(-1)||null}
const fixed=x=>Number(x||0).toFixed(1);
function html(){const last=latest();if(!last)return '<p>移動観察：試合開始後に記録されます。ログはこのブラウザの現在のページ内のみ保持します。</p>';let rs=last.rows.filter(r=>r.role==='AI').sort((a,b)=>a.brainId-b.brainId),p=last.rows.find(r=>r.role==='PLAYER'),tot=(k)=>rs.reduce((s,r)=>s+r[k],0),ts=tot('commanded');return `<div class="movementAudit"><p><b>移動観察 #${last.id}</b> · ${last.reason==='playing'?'記録中':'記録終了'} · 対象${rs.length}体</p><p>移動指示 ${fixed(ts)}秒 / 指示なし ${fixed(tot('noCommand'))}秒 / 強い移動阻害 ${fixed(tot('blocked'))}秒 / 到達 ${tot('arrivals')}回 / 期限切れ ${tot('expired')}回</p><p style="font-size:.78em">「阻害」は移動指示量に対し35%未満しか進めなかった時間。戦闘中の移動も含みます。目標は巡回のみ集計。研究画面の「移動ログCSV」で各個体と位置履歴（5分刻み）を確認できます。</p>${p?`<p><b>PLAYER</b> · 生存中の記録 ${fixed(p.seconds)}秒 / 移動指示 ${fixed(p.commanded)}秒 / 移動 ${fixed(p.travel)}m / 敵100m以内 ${fixed(p.enemyNearSeconds)}秒 / 射撃 ${p.shots}・命中 ${p.hits}・撃破 ${p.kills}</p>`:''}<p style="font-size:.78em">PLAYERは生存中のみ集計。AIの「近接時間」はプレイヤーとの距離であり、視認・交戦の証明ではありません。無操作の連続試合もPLAYERとして記録します。</p></div>`}
function csv(){const snapshots=[...history,...(current?[extract(current)]:[])];const headers=['match','state','role','brain','name','elapsed_seconds','commanded_seconds','no_command_seconds','blocked_seconds','partial_seconds','moved_meters','move_calls','patrol_goals','patrol_arrivals','patrol_expired','patrol_interrupted','active_goal','ai_near_player_100m_seconds','ai_player_within_78m_seconds','player_enemy_near_100m_seconds','player_crouched_seconds','player_shots','player_hits','player_kills','alive_at_match_end','start_x','start_z','last_x','last_z','straight_line_from_start_m','nearest_settlement_at_end','distance_to_settlement_m','within_settlement_60m','explore_policy_last','explore_context_last','explore_policy_choices'];for(const t of checkpoints)headers.push('x_'+t+'s','z_'+t+'s');headers.push('alpha_x','alpha_z','bravo_x','bravo_z','charlie_x','charlie_z');const rows=[headers.join(',')];for(const s of snapshots)for(const r of s.rows){const last=r.lastPos,loc=location(last,s.settlements),straight=last&&r.startPos?Math.hypot(last.x-r.startPos.x,last.z-r.startPos.z):null;const f=p=>p===null||p===undefined?'':Number(p).toFixed(1);const fields=[s.id,s.reason,r.role,r.role==='PLAYER'?'':r.brainId+1,r.name,f(r.seconds),f(r.commanded),f(r.noCommand),f(r.blocked),f(r.partial),f(r.travel),r.commands,r.goals,r.arrivals,r.expired,r.interrupted,r.goal?.kind||'',f(r.nearPlayerSeconds),f(r.playerWithinSightSeconds),f(r.enemyNearSeconds),f(r.crouchedSeconds),r.shots,r.hits,r.kills,r.alive?'YES':'NO',f(r.startPos?.x),f(r.startPos?.z),f(last?.x),f(last?.z),f(straight),loc.name,f(loc.distance),loc.name?(loc.near?'YES':'NO'):'',r.explorePolicy||'',r.exploreContext||'',r.exploreDecisions||0];for(const t of checkpoints)fields.push(f(r.checkpoints[t]?.x),f(r.checkpoints[t]?.z));for(const name of ['ALPHA','BRAVO','CHARLIE']){const settlement=s.settlements?.find(q=>q.name===name);fields.push(f(settlement?.x),f(settlement?.z))}rows.push(fields.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(','))}return '\ufeff'+rows.join('\r\n')+'\r\n'}
function downloadCSV(content,filename){
 const blob=new Blob([content],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function download(){
 if(!history.length&&!current){alert('まだ移動ログがありません。試合を開始してください。');return}
 downloadCSV(csv(),'last_signal_movement_audit.csv');
}
function downloadTactics(){
 const runs=[...tacticsHistory,...(current?.tacticsEvents.length?[current]:[])].slice(-TACTICS_MATCH_LIMIT);
 if(!runs.length){alert('まだ戦術ログがありません。通常試合を開始するか、AI連続試合で戦術の試行が発生するまで実行してください。');return}
 const columns=['match','state','elapsed_seconds','phase','actor','role','event','detail','x','z','yaw_rad',
  'hp','weapon','mag','reserve','other_actor','distance_m','source_weapon'];
 const rows=[columns.join(',')];
 const cell=value=>'"'+String(typeof value==='number'?Number(value.toFixed(3)):value??'').replace(/"/g,'""')+'"';
 for(const run of runs)for(const e of run.tacticsEvents){
  rows.push([run.id,run.reason,e.elapsed,e.phase,e.actor,e.role,e.event,e.detail,e.x,e.z,e.yaw,e.hp,
   e.weapon,e.mag,e.reserve,e.other,e.distance,e.sourceWeapon].map(cell).join(','));
 }
 downloadCSV('\ufeff'+rows.join('\r\n')+'\r\n','last_signal_tactics.csv');
}
window.LSMovementAudit={start,register,beginFrame,move,goal,endFrame,playerFrame,tacticsEvent,finish,html,download,downloadTactics,
 snapshot:()=>({current:current?extract(current):null,history:history.slice()})};
})();
