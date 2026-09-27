/* Weapon and equipment balance data */
(()=>{'use strict';
const weapons=[
 {id:'knife',name:'FIELD KNIFE',kind:'melee',dmg:55,mag:Infinity,reserve:Infinity,reload:0,rof:1.5,spread:0,range:2.4,lead:.12,auto:false,moveMul:1.05,kick:.35,color:'#cdd7d0'},
 {id:'p9',name:'P9 SIDEARM',kind:'sidearm',dmg:24,mag:15,reserve:75,reload:1.35,rof:4.2,spread:.022,range:60,lead:.08,auto:false,recoil:.0045,recoilYaw:.0035,moveMul:1.04,kick:.65,color:'#d6c9a8'},
 {id:'r45',name:'R-45 REVOLVER',kind:'sidearm',dmg:49,mag:6,reserve:36,reload:2.45,rof:2.1,spread:.016,range:72,lead:.16,auto:false,recoil:.013,recoilYaw:.0065,moveMul:1,kick:1.25,color:'#e2b35e'},
 {id:'m10',name:'M10 MACHINE PISTOL',kind:'sidearm',dmg:17,mag:24,reserve:96,reload:1.55,rof:12,spread:.045,range:42,lead:.07,auto:true,recoil:.0032,recoilYaw:.0055,moveMul:1.01,kick:.55,color:'#b7c2b8'},
 {id:'hush',name:'HUSH-9',kind:'sidearm',dmg:27,mag:12,reserve:60,reload:1.5,rof:3.7,spread:.013,range:64,lead:.09,auto:false,recoil:.0038,recoilYaw:.0025,moveMul:1.03,kick:.55,color:'#6fa88d'},
 {id:'hc12',name:'HC-12 HAND CANNON',kind:'sidearm',dmg:68,mag:5,reserve:25,reload:1.9,rof:1.15,spread:.024,range:68,lead:.24,auto:false,recoil:.019,recoilYaw:.009,moveMul:.94,kick:1.65,color:'#d97b58'},
 {id:'viper',name:'VIPER SMG',kind:'primary',dmg:19,mag:32,reserve:160,reload:1.6,rof:13.5,spread:.047,range:48,lead:.06,auto:true,recoil:.0032,recoilYaw:.0055,moveMul:1.05,kick:.5,color:'#78c49c'},
 {id:'mp7',name:'K7 PDW',kind:'primary',dmg:21,mag:40,reserve:160,reload:1.75,rof:11.5,spread:.035,range:56,lead:.07,auto:true,recoil:.0025,recoilYaw:.0038,moveMul:1.06,kick:.42,color:'#8fa9a0'},
 {id:'ar4',name:'AR-4 RANGER',kind:'primary',dmg:31,mag:30,reserve:120,reload:2,rof:8.2,spread:.023,range:78,lead:.1,auto:true,recoil:.0048,recoilYaw:.0038,moveMul:1,kick:.72,color:'#c2b071'},
 {id:'akm',name:'K-47 NOMAD',kind:'primary',dmg:38,mag:30,reserve:120,reload:2.25,rof:6.6,spread:.033,range:76,lead:.13,auto:true,recoil:.0095,recoilYaw:.0072,moveMul:.94,kick:1.15,color:'#b87955'},
 {id:'burst',name:'BR-3 BURST',kind:'primary',dmg:29,mag:27,reserve:108,reload:1.95,rof:10.5,spread:.019,range:82,lead:.09,auto:false,recoil:.0062,recoilYaw:.0032,moveMul:.98,kick:.78,burst:3,color:'#8bb5a0'},
 {id:'carbine',name:'C8 CARBINE',kind:'primary',dmg:34,mag:24,reserve:96,reload:1.75,rof:7.4,spread:.017,range:85,lead:.1,auto:true,recoil:.003,recoilYaw:.0025,moveMul:1.04,kick:.48,color:'#a8b687'},
 {id:'dmr',name:'DMR-17',kind:'primary',dmg:57,mag:12,reserve:60,reload:2.15,rof:2.7,spread:.009,range:95,lead:.18,auto:false,recoil:.01,recoilYaw:.0042,moveMul:.91,kick:1.12,color:'#8cae90'},
 {id:'longshot',name:'LONGSHOT .308',kind:'primary',dmg:92,mag:5,reserve:30,reload:2.45,rof:.85,spread:.004,range:120,lead:.42,auto:false,recoil:.02,recoilYaw:.006,moveMul:.82,kick:1.55,color:'#97a8ad'},
 {id:'rail',name:'RAVEN RAIL RIFLE',kind:'primary',dmg:115,mag:3,reserve:15,reload:3.25,rof:.48,spread:.002,range:95,lead:.68,auto:false,recoil:.028,recoilYaw:.008,moveMul:.78,kick:1.95,color:'#78d5d8'},
 {id:'sg8',name:'SG-8 BREACHER',kind:'primary',dmg:13,mag:8,reserve:48,reload:3.15,rof:1.05,spread:.105,range:28,lead:.2,auto:false,pellets:8,recoil:.016,recoilYaw:.008,moveMul:.91,kick:1.48,color:'#df9954'},
 {id:'auto12',name:'AUTO-12',kind:'primary',dmg:9,mag:12,reserve:60,reload:2.35,rof:3.2,spread:.125,range:24,lead:.17,auto:true,pellets:7,recoil:.01,recoilYaw:.007,moveMul:.87,kick:1.05,color:'#c86e50'},
 {id:'lmg',name:'M60 ANVIL',kind:'primary',dmg:35,mag:80,reserve:240,reload:4.65,rof:8.8,spread:.048,range:74,lead:.22,auto:true,recoil:.0065,recoilYaw:.0068,moveMul:.78,kick:.92,color:'#9d9469'},
 {id:'crossbow',name:'SILENT CROSSBOW',kind:'primary',dmg:105,mag:1,reserve:18,reload:2.7,rof:.55,spread:.006,range:88,lead:.5,auto:false,recoil:.008,recoilYaw:.0028,moveMul:.92,kick:.82,color:'#768f72'},
 {id:'flame',name:'FIRELANCE',kind:'primary',dmg:8,mag:60,reserve:180,reload:3.4,rof:14,spread:.09,range:14,lead:.14,auto:true,pellets:2,recoil:.002,recoilYaw:.0045,moveMul:.86,kick:.28,color:'#ff7146'}

];
const BALLISTICS={
 p9:[105,.55],r45:[112,.58],m10:[100,.50],hush:[108,.48],hc12:[110,.62],
 viper:[108,.46],mp7:[116,.44],ar4:[136,.43],akm:[130,.47],burst:[140,.42],carbine:[146,.40],
 dmr:[160,.60],longshot:[155,.85],rail:[240,.15],sg8:[88,.72],auto12:[84,.75],lmg:[128,.50],crossbow:[65,1.05],flame:[38,.12]
};
for(const w of weapons){let b=BALLISTICS[w.id];if(b){w.speed=b[0];w.gravity=b[1]}else{w.speed=0;w.gravity=0}}
const ADS_PROFILES={
 sidearm:{aimTime:.12,adsSpreadMul:.72,adsRecoilMul:.82,adsMoveMul:.88,adsLookMul:.80,adsFov:.93,adsViewShift:.07,adsViewLift:.025,adsViewScale:1.05},
 machinepistol:{aimTime:.13,adsSpreadMul:.74,adsRecoilMul:.84,adsMoveMul:.88,adsLookMul:.80,adsFov:.93,adsViewShift:.075,adsViewLift:.028,adsViewScale:1.05},
 smg:{aimTime:.14,adsSpreadMul:.68,adsRecoilMul:.80,adsMoveMul:.84,adsLookMul:.76,adsFov:.91,adsViewShift:.085,adsViewLift:.032,adsViewScale:1.06},
 rifle:{aimTime:.18,adsSpreadMul:.55,adsRecoilMul:.72,adsMoveMul:.76,adsLookMul:.68,adsFov:.88,adsViewShift:.10,adsViewLift:.038,adsViewScale:1.08},
 dmr:{aimTime:.22,adsSpreadMul:.46,adsRecoilMul:.68,adsMoveMul:.70,adsLookMul:.58,adsFov:.82,adsViewShift:.105,adsViewLift:.04,adsViewScale:1.08},
 sniper:{aimTime:.30,adsSpreadMul:.38,adsRecoilMul:.65,adsMoveMul:.62,adsLookMul:.34,adsFov:.23,adsViewShift:.10,adsViewLift:.035,adsViewScale:1.06},
 rail:{aimTime:.32,adsSpreadMul:.40,adsRecoilMul:.68,adsMoveMul:.60,adsLookMul:.45,adsFov:.80,adsViewShift:.11,adsViewLift:.04,adsViewScale:1.07},
 shotgun:{aimTime:.20,adsSpreadMul:.80,adsRecoilMul:.76,adsMoveMul:.72,adsLookMul:.68,adsFov:.92,adsViewShift:.09,adsViewLift:.038,adsViewScale:1.08},
 lmg:{aimTime:.30,adsSpreadMul:.58,adsRecoilMul:.62,adsMoveMul:.58,adsLookMul:.58,adsFov:.90,adsViewShift:.10,adsViewLift:.035,adsViewScale:1.07},
 crossbow:{aimTime:.24,adsSpreadMul:.48,adsRecoilMul:.80,adsMoveMul:.68,adsLookMul:.60,adsFov:.86,adsViewShift:.09,adsViewLift:.04,adsViewScale:1.08},
 flame:{aimTime:.16,adsSpreadMul:.90,adsRecoilMul:.90,adsMoveMul:.76,adsLookMul:.78,adsFov:.95,adsViewShift:.07,adsViewLift:.03,adsViewScale:1.04}
};
function adsFamily(w){if(w.kind==='sidearm')return w.id==='m10'?'machinepistol':'sidearm';if(['viper','mp7'].includes(w.id))return'smg';if(['ar4','akm','burst','carbine'].includes(w.id))return'rifle';if(w.id==='dmr')return'dmr';if(w.id==='longshot')return'sniper';if(w.id==='rail')return'rail';if(['sg8','auto12'].includes(w.id))return'shotgun';if(w.id==='lmg')return'lmg';if(w.id==='crossbow')return'crossbow';if(w.id==='flame')return'flame';return null}
for(const w of weapons){let p=ADS_PROFILES[adsFamily(w)];if(p)Object.assign(w,p)}
const ADS_OVERRIDES={hc12:{aimTime:.18},carbine:{aimTime:.15},burst:{aimTime:.17},akm:{aimTime:.20},sg8:{aimTime:.22},auto12:{aimTime:.18}};
for(const w of weapons)if(ADS_OVERRIDES[w.id])Object.assign(w,ADS_OVERRIDES[w.id]);
function ballisticDropLabel(w){if(w.kind==='melee')return'—';if(w.id==='crossbow')return'大';if((w.gravity||0)>=.75)return'中';if((w.gravity||0)>=.45)return'小';return'極小'}
function projectileVisualLabel(w){if(w.kind==='melee')return'—';if(w.id==='crossbow')return'非発光';if(w.id==='lmg')return'5発に1発 曳光';if(w.id==='rail')return'高輝度';if(w.id==='longshot'||w.id==='dmr')return'精密軌跡';return'短い残像'}
const utilities=[
 {id:'util_rope',name:'GRAPPLING ROPE',kind:'utility',utility:'rope',charges:Infinity,color:'#d4c29a',description:'15m以内の屋根へ登る・再使用8秒'},
 {id:'util_mine',name:'MINE KIT',kind:'utility',utility:'mine',charges:3,color:'#d4893c',description:'範囲ダメージ・3個'},
 {id:'util_wire',name:'TRIPWIRE KIT',kind:'utility',utility:'wire',charges:3,color:'#c7aa64',description:'位置を8秒間公開・3個'},
 {id:'util_bear',name:'BEAR TRAP KIT',kind:'utility',utility:'bear',charges:3,color:'#a98a62',description:'3秒間移動不能・3個'}
];

window.LSData=Object.freeze({weapons,utilities,ballisticDropLabel,projectileVisualLabel});
})();
