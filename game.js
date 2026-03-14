// =============================================================
//  GLITCH TAP — Full Unified Blueprint Implementation
// =============================================================

// ── Kaboom init (target the pre-existing canvas) ─────────────
kaboom({
    width: 800, height: 600,
    background: [5, 5, 10],
    canvas: document.getElementById("kaboom-canvas"),
})

// ── Sounds ────────────────────────────────────────────────────
loadSound("click",  "https://kaboomjs.com/sounds/score.mp3")
loadSound("danger", "https://kaboomjs.com/sounds/explosion.mp3")
loadSound("spread", "https://kaboomjs.com/sounds/hit1.mp3")

// ── Palette ───────────────────────────────────────────────────
const COL = {
    MAGENTA:[255,0,255], CYAN:[0,255,255], YELLOW:[255,255,0],
    RED:[255,30,30], GREEN:[0,255,128], WHITE:[255,255,255],
    ORANGE:[255,140,0], GOLD:[255,215,0], PURPLE:[180,0,255],
}
const GLITCH_COLS = [COL.MAGENTA,COL.CYAN,COL.RED,COL.GREEN,COL.YELLOW,COL.ORANGE]
function glitchColor(){ return choose(GLITCH_COLS) }
function glitchSize() { return rand(14,26) }

// =============================================================
//  OVERLAY CANVAS — all screen-level fx live here
// =============================================================
const OV  = document.getElementById("overlay")
const OVC = OV.getContext("2d")
OV.width  = 800
OV.height = 600

// ── Global state shared between kaboom and overlay ────────────
const GS = {
    active:        false,
    corruption:    0,
    gameOver:      false,
    ascii:         false,
    mirrorFired:   false,
    desyncLocked:  false,
    overclockActive: false,
    mouseX:        400,
    mouseY:        300,
    chainLines:    [],   // [{x1,y1,x2,y2,segs,age,life,col}]
    ghostEchoes:   [],   // [{x,y,sz,age,life}]
    leakPools:     [],   // [{x,y,r,alpha}]
    glitchShaders: [],   // [{y,h,ox,age,life}]
    processList:   [],   // [{name,state,age}]  max 8
    mirrorAge:     0,
    mirrorLife:    3.0,
    desyncY:       0,
    highScore:     0,
}

// ── Mouse tracking ────────────────────────────────────────────
const _wrap = document.getElementById("wrap")
document.addEventListener("mousemove", e => {
    const r = _wrap.getBoundingClientRect()
    GS.mouseX = e.clientX - r.left
    GS.mouseY = e.clientY - r.top
})

// ── ASCII meltdown grid ───────────────────────────────────────
const A_COLS=80, A_ROWS=40, A_CW=10, A_CH=15
const A_CHARS="01ABCDEF!@#$%^&*<>?|{}~GLITCH".split("")
const asciiCols = Array.from({length:A_COLS},()=>({
    y: rand(-A_ROWS,0), speed: rand(3,10),
    chars: Array.from({length:A_ROWS},()=>choose(A_CHARS))
}))
function resetAscii(){
    asciiCols.forEach(c=>{
        c.y=rand(-A_ROWS,0); c.speed=rand(3,10)
        c.chars=Array.from({length:A_ROWS},()=>choose(A_CHARS))
    })
}

// ── Cursor trail ──────────────────────────────────────────────
const cursorTrail = []

// ── Reactive audio (Web Audio API — initialised once) ─────────
let audioCtx=null, audioSource=null, audioGain=null, audioBQ=null, audioFrozen=false
function initAudio(){
    if(audioCtx) return
    try {
        audioCtx  = new (window.AudioContext||window.webkitAudioContext)()
        audioGain = audioCtx.createGain()
        audioBQ   = audioCtx.createBiquadFilter()
        audioBQ.type      = "lowpass"
        audioBQ.frequency.value = 8000
        audioGain.gain.value    = 0.18
        audioBQ.connect(audioGain)
        audioGain.connect(audioCtx.destination)
    } catch(e){ audioCtx=null }
}
function updateAudio(pct){
    if(!audioCtx||audioFrozen) return
    try {
        audioBQ.frequency.value = Math.max(200, 8000-(pct*7800))
        if(pct>0.8){
            const t=audioCtx.currentTime
            audioGain.gain.setTargetAtTime(pct>0.9?0:0.12,t,0.1)
        }
    } catch(e){}
}
function freezeAudio(){
    audioFrozen=true
    if(audioGain&&audioCtx) try{ audioGain.gain.setTargetAtTime(0,audioCtx.currentTime,0.3) }catch(e){}
}
function thawAudio(){
    audioFrozen=false
    if(audioGain&&audioCtx) try{
        audioBQ.frequency.value=8000
        audioGain.gain.setTargetAtTime(0.18,audioCtx.currentTime,0.2)
    }catch(e){}
}

// ── PROCESS LIST helpers ──────────────────────────────────────
const PROC_NAMES=["GLITCH.EXE","CORRUPT_SYS","NULL_PTR_DAEMON","MEMORY_LEAK.DLL",
    "VIRUS_CORE","SEGFAULT_32","BUFFER_OVF","KERNEL_PANIC","ROOTKIT_SVC","DATA_ROT"]
function procAdd(name){
    if(GS.processList.length>=8) GS.processList.shift()
    GS.processList.push({name:name||choose(PROC_NAMES), state:"RUNNING", age:0})
}
function procKill(){
    const running=GS.processList.filter(p=>p.state==="RUNNING")
    if(running.length>0) running[running.length-1].state="[KILLED]"
}

// =============================================================
//  OVERLAY RENDER LOOP
// =============================================================
let _lastT=0
function overlayFrame(ts){
    requestAnimationFrame(overlayFrame)
    const dtt=Math.min((ts-_lastT)/1000, 0.05)
    _lastT=ts
    OVC.clearRect(0,0,800,600)

    // ── RANK 5: Reactive audio update ─────────────────────
    updateAudio(GS.corruption)

    if(!GS.active && !GS.ascii && !GS.gameOver){
        drawCursorOnly()
        return
    }

    // ── RANK 1: GPU Glitch Shader strips ──────────────────
    if(GS.active && Math.random()<0.15+GS.corruption*0.45){
        GS.glitchShaders.push({
            y:Math.random()*600, h:rand(2,8+GS.corruption*22),
            ox:(Math.random()-0.5)*28*(1+GS.corruption*2.5),
            age:0, life:rand(0.04,0.1),
            col:Math.random()<0.5?"rgba(255,0,255,0.13)":"rgba(0,255,255,0.11)"
        })
    }
    GS.glitchShaders=GS.glitchShaders.filter(s=>{
        s.age+=dtt
        if(s.age>=s.life) return false
        OVC.save()
        OVC.globalAlpha=(1-s.age/s.life)*0.55
        OVC.fillStyle=s.col
        OVC.fillRect(0,s.y,800,s.h)
        OVC.restore()
        return true
    })

    // ── RANK 4: CRT chromatic aberration ──────────────────
    if(GS.active||GS.gameOver){
        const ca=GS.corruption*5+1.5
        OVC.save()
        OVC.globalCompositeOperation="screen"
        OVC.globalAlpha=0.06+GS.corruption*0.1
        OVC.fillStyle="red";   OVC.fillRect(-ca*0.5,0,800,600)
        OVC.fillStyle="cyan";  OVC.fillRect( ca*0.5,0,800,600)
        OVC.restore()
        OVC.save()
        OVC.globalAlpha=0.09
        for(let sy=0;sy<600;sy+=3){ OVC.fillStyle="#000"; OVC.fillRect(0,sy,800,1) }
        OVC.restore()
        const vg=OVC.createRadialGradient(400,300,170,400,300,510)
        vg.addColorStop(0,"rgba(0,0,0,0)")
        vg.addColorStop(1,"rgba(0,0,0,0.7)")
        OVC.save(); OVC.fillStyle=vg; OVC.fillRect(0,0,800,600); OVC.restore()
    }

    // ── RANK 1: Chain lightning lines ─────────────────────
    GS.chainLines=GS.chainLines.filter(ln=>{
        ln.age+=dtt
        if(ln.age>=ln.life) return false
        const a=(1-ln.age/ln.life)
        OVC.save()
        OVC.strokeStyle=ln.col
        OVC.lineWidth=1.5
        OVC.globalAlpha=a*0.9
        OVC.beginPath()
        OVC.moveTo(ln.x1,ln.y1)
        ln.segs.forEach(s=>OVC.lineTo(s[0],s[1]))
        OVC.lineTo(ln.x2,ln.y2)
        OVC.stroke()
        OVC.restore()
        return true
    })

    // ── RANK 7: Ghost Echo outlines (strokes only, never fills) ──
    GS.ghostEchoes=GS.ghostEchoes.filter(g=>{
        g.age+=dtt
        if(g.age>=g.life) return false
        const a=(1-g.age/g.life)*0.7
        const sc=1+(g.age/g.life)*0.5
        OVC.save()
        OVC.strokeStyle=`rgba(0,200,255,${a})`
        OVC.lineWidth=1.2
        OVC.strokeRect(g.x-(g.sz*sc)/2, g.y-(g.sz*sc)/2, g.sz*sc, g.sz*sc)
        OVC.restore()
        return true
    })

    // ── RANK 2: Memory Leak filled pools ──────────────────
    GS.leakPools.forEach(lp=>{
        OVC.save()
        const grad=OVC.createRadialGradient(lp.x,lp.y,0,lp.x,lp.y,lp.r)
        grad.addColorStop(0,`rgba(0,255,80,${lp.alpha*0.35})`)
        grad.addColorStop(1,"rgba(0,255,80,0)")
        OVC.fillStyle=grad
        OVC.beginPath(); OVC.arc(lp.x,lp.y,lp.r,0,Math.PI*2); OVC.fill()
        OVC.restore()
    })

    // ── RANK 8: Process list terminal ─────────────────────
    if(GS.active && GS.processList.length>0){
        OVC.save()
        OVC.fillStyle="rgba(0,0,0,0.55)"
        OVC.fillRect(600,460,196,136)
        OVC.strokeStyle="rgba(0,255,128,0.4)"
        OVC.lineWidth=1
        OVC.strokeRect(600,460,196,136)
        OVC.font="9px monospace"
        GS.processList.forEach((p,i)=>{
            const col2=p.state==="[KILLED]"?"rgba(255,30,30,0.85)":"rgba(0,255,128,0.85)"
            OVC.fillStyle=col2
            const nm=p.name.substring(0,16)
            OVC.fillText(nm+" "+p.state, 606, 474+i*15)
        })
        OVC.restore()
    }

    // ── RANK 10: Mirror Dimension Split (one-time 3s) ──────
    if(GS.mirrorAge>0){
        GS.mirrorAge-=dtt
        const kc=document.getElementById("kaboom-canvas")
        OVC.save()
        OVC.globalAlpha=0.28*(GS.mirrorAge/GS.mirrorLife)
        OVC.translate(800,0); OVC.scale(-1,1)
        OVC.drawImage(kc,14,0,800,600)
        OVC.restore()
    }

    // ── RANK 4: Screen desync (CSS transform on kaboom canvas) ──
    // Handled via triggerDesync() in kaboom scene

    // ── RANK 7: Cursor + trail ────────────────────────────
    drawCursorOnly()

    // ── RANK 10: ASCII meltdown ───────────────────────────
    if(GS.ascii){
        OVC.fillStyle="rgba(0,0,0,0.88)"
        OVC.fillRect(0,0,800,600)
        OVC.font=`bold ${A_CW*0.9}px monospace`
        asciiCols.forEach((col3,ci)=>{
            col3.y+=col3.speed*dtt
            if(col3.y>A_ROWS) col3.y=rand(-4,0)
            for(let ri=0;ri<A_ROWS;ri++){
                if(Math.random()<0.03) col3.chars[ri]=choose(A_CHARS)
                const drawY=((ri+Math.floor(col3.y))%A_ROWS+A_ROWS)%A_ROWS
                const fade=Math.max(0,1-((drawY/A_ROWS)*1.1))
                if(ri===0) OVC.fillStyle=`rgba(255,255,255,${fade*0.95})`
                else if(ri<4) OVC.fillStyle=`rgba(255,0,255,${fade*0.7})`
                else OVC.fillStyle=`rgba(0,255,128,${fade*0.6})`
                OVC.fillText(col3.chars[ri], ci*A_CW, drawY*A_CH+A_CH)
            }
        })
    }
}
requestAnimationFrame(overlayFrame)

function drawCursorOnly(){
    cursorTrail.unshift({x:GS.mouseX, y:GS.mouseY})
    if(cursorTrail.length>16) cursorTrail.length=16
    cursorTrail.forEach((pt,i)=>{
        const a=(1-i/cursorTrail.length)*0.5
        const sz=2.5+i*0.35
        const jx=GS.corruption>0.4?Math.sin(i*0.8+_lastT*0.003)*GS.corruption*12:0
        OVC.save()
        OVC.globalAlpha=a
        OVC.strokeStyle=i%2===0?"#ff00ff":"#00ffff"
        OVC.lineWidth=0.8
        OVC.strokeRect(pt.x+jx-sz/2, pt.y-sz/2, sz, sz)
        OVC.restore()
    })
    const jx2=GS.corruption>0.5?(Math.random()-0.5)*GS.corruption*7:0
    const jy2=GS.corruption>0.5?(Math.random()-0.5)*GS.corruption*7:0
    const cx=GS.mouseX+jx2, cy=GS.mouseY+jy2
    OVC.save()
    OVC.strokeStyle="#00ffcc"; OVC.lineWidth=1.5; OVC.globalAlpha=0.95
    OVC.beginPath(); OVC.moveTo(cx-10,cy); OVC.lineTo(cx+10,cy); OVC.stroke()
    OVC.beginPath(); OVC.moveTo(cx,cy-10); OVC.lineTo(cx,cy+10); OVC.stroke()
    OVC.strokeRect(cx-4,cy-4,8,8)
    OVC.restore()
}

// ── Lightning chain builder ───────────────────────────────────
function fireChain(x1,y1,x2,y2,col){
    const segs=[]
    const steps=6
    for(let i=1;i<steps;i++){
        const t=i/steps
        segs.push([
            x1+(x2-x1)*t + (Math.random()-0.5)*22,
            y1+(y2-y1)*t + (Math.random()-0.5)*22
        ])
    }
    GS.chainLines.push({x1,y1,x2,y2,segs,age:0,life:0.18,col:col||"rgba(0,255,255,0.9)"})
}

// ── Desync ────────────────────────────────────────────────────
let _desyncActive=false
function triggerDesync(){
    if(_desyncActive||GS.desyncLocked) return
    _desyncActive=true
    const kc=document.getElementById("kaboom-canvas")
    const off=rand(8,24)*(Math.random()<0.5?1:-1)
    kc.style.transform=`translateY(${off}px)`
    setTimeout(()=>{ kc.style.transform="translateY(0px)"; setTimeout(()=>{_desyncActive=false},70) },70)
}

// =============================================================
//  KABOOM SCENE HELPERS
// =============================================================
function addScanlines(){
    for(let y=0;y<height();y+=4)
        add([rect(width(),1),pos(0,y),color(0,0,0),opacity(0.13),fixed(),z(1)])
}
function addCRTVignette(){
    add([rect(width(),height()),pos(0,0),color(0,0,0),opacity(0.20),fixed(),z(1)])
}

// Scramble text for UI breakdown (Rank 5)
const SC="@#$%!?&*01ABCDEF<>[]|~^"
function scramble(str,pct){
    if(pct<0.45) return str
    const intensity=(pct-0.4)*2.2
    return str.split("").map(c=>c===" "?" ":Math.random()<intensity?SC[Math.floor(Math.random()*SC.length)]:c).join("")
}

// =============================================================
//  SCENE: START
// =============================================================
scene("start",()=>{
    GS.active=false; GS.ascii=false; GS.gameOver=false; GS.corruption=0
    GS.leakPools=[]; GS.chainLines=[]; GS.ghostEchoes=[]; GS.processList=[]
    GS.mirrorFired=false; GS.mirrorAge=0; GS.desyncLocked=false
    thawAudio()
    addScanlines(); addCRTVignette()

    loop(0.08,()=>{
        if(Math.random()<0.35){
            const s=add([rect(width(),rand(1,4)),pos(0,rand(0,height())),
                color(...choose([COL.MAGENTA,COL.CYAN])),opacity(rand(0.03,0.1)),fixed(),z(0)])
            wait(0.1,()=>{ if(s.exists()) destroy(s) })
        }
    })

    add([text("GLITCH TAP",{size:52,font:"monospace"}),
        pos(width()/2,height()/2-110),anchor("center"),color(...COL.MAGENTA),z(2)])
    add([text("SYSTEM BREACH DETECTED",{size:16,font:"monospace"}),
        pos(width()/2,height()/2-58),anchor("center"),color(...COL.CYAN),opacity(0.85),z(2)])
    add([text("Click glitches before they spread\nand corrupt the entire display.",{size:14,font:"monospace"}),
        pos(width()/2,height()/2),anchor("center"),color(...COL.WHITE),opacity(0.7),z(2)])

    if(GS.highScore>0)
        add([text("HIGH SCORE: "+GS.highScore,{size:18,font:"monospace"}),
            pos(width()/2,height()/2+68),anchor("center"),color(...COL.YELLOW),z(2)])

    let pv=true
    const sp=add([text("[ PRESS SPACE TO BOOT ]",{size:18,font:"monospace"}),
        pos(width()/2,height()/2+118),anchor("center"),color(...COL.GREEN),z(2)])
    loop(0.55,()=>{ pv=!pv; sp.opacity=pv?1:0.08 })

    onKeyPress("space",()=>{ initAudio(); go("game") })
    onMousePress(()=>{ initAudio(); go("game") })
})

// =============================================================
//  SCENE: GAME
// =============================================================
scene("game",()=>{
    GS.active=true; GS.ascii=false; GS.gameOver=false; GS.corruption=0
    GS.leakPools=[]; GS.chainLines=[]; GS.ghostEchoes=[]; GS.processList=[]
    GS.mirrorFired=false; GS.mirrorAge=0; GS.desyncLocked=false; GS.overclockActive=false
    thawAudio()

    let score=0, combo=0, comboGen=0, overclockGen=0
    let bossAlive=false, anomalySlot=null   // "well"|"portal"|null
    const MAX=25

    addScanlines(); addCRTVignette()

    const dangerOverlay=add([rect(width(),height()),pos(0,0),color(...COL.RED),opacity(0),fixed(),z(2)])

    add([text("GLITCH TAP",{size:22,font:"monospace"}),
        pos(width()/2,24),anchor("center"),color(...COL.MAGENTA),opacity(0.65),fixed(),z(30)])
    const scoreLabel=add([text("SCORE: 0",{size:18,font:"monospace"}),pos(16,16),color(...COL.WHITE),fixed(),z(30)])
    const comboLabel=add([text("",{size:15,font:"monospace"}),pos(16,44),color(...COL.CYAN),opacity(0),fixed(),z(30)])
    const ocLabel=add([text("",{size:14,font:"monospace"}),pos(16,64),color(...COL.GOLD),opacity(0),fixed(),z(30)])

    let threatBarObj=null
    function redrawBar(p){
        if(threatBarObj&&threatBarObj.exists()) destroy(threatBarObj)
        threatBarObj=add([rect(Math.max(0,width()*p),8),pos(0,height()-8),color(...COL.RED),fixed(),z(29)])
    }
    redrawBar(0)
    const threatLabel=add([text("THREAT: 0%",{size:12,font:"monospace"}),
        pos(width()-16,height()-22),anchor("right"),color(...COL.RED),opacity(0.75),fixed(),z(30)])

    // ── Amber overclock tint ──────────────────────────────
    const ocOverlay=add([rect(width(),height()),pos(0,0),color(255,140,0),opacity(0),fixed(),z(3)])

    // ── Combo ─────────────────────────────────────────────
    function triggerCombo(){
        combo++
        const gen=++comboGen
        if(!GS.overclockActive){
            wait(1.5,()=>{ if(comboGen===gen){ combo=0; if(comboLabel.exists()) comboLabel.opacity=0 } })
        }
        if(combo>=2){ comboLabel.text="x"+combo+" COMBO"; comboLabel.opacity=1 }
    }
    function comboMult(){ return combo>=5?3:combo>=3?2:1 }
    function calcPts(){
        const base=comboMult()
        return GS.overclockActive ? base+2 : base
    }

    // ── RANK 3: Data fragment explosion ───────────────────
    function dataExplosion(px,py,col,count){
        const n=count||14
        for(let i=0;i<n;i++){
            const angle=(Math.PI*2/n)*i+rand(-0.4,0.4)
            const spd=rand(55,210)
            const vx=Math.cos(angle)*spd, vy=Math.sin(angle)*spd
            const useChar=Math.random()<0.45
            const fcol=choose([col,COL.WHITE,COL.CYAN,COL.MAGENTA])
            const f=useChar
                ? add([text(choose(SC.split("")),{size:rand(8,13),font:"monospace"}),
                    pos(px+rand(-5,5),py+rand(-5,5)),color(...fcol),opacity(1),z(42),{vx,vy,grav:rand(40,110)}])
                : add([rect(rand(2,6),rand(2,6)),
                    pos(px+rand(-5,5),py+rand(-5,5)),color(...fcol),opacity(1),z(42),{vx,vy,grav:rand(40,110)}])
            f.onUpdate(()=>{
                if(!f.exists()) return
                f.pos.x+=f.vx*dt(); f.pos.y+=f.vy*dt(); f.vy+=f.grav*dt()
                f.opacity-=dt()*2.0
                if(f.opacity<=0) destroy(f)
            })
        }
    }

    // ── RANK 2: Spread tendril + leak pool ────────────────
    function spawnTendril(ox,oy){
        const angle=rand(0,Math.PI*2), len=rand(28,75)
        const tc=choose([COL.MAGENTA,COL.CYAN,COL.RED])
        for(let i=0;i<7;i++){
            const t=i/7
            const seg=add([rect(rand(3,7),rand(2,4)),
                pos(ox+Math.cos(angle)*len*t+rand(-5,5), oy+Math.sin(angle)*len*t+rand(-5,5)),
                color(...tc),opacity(0.65-t*0.45),z(5)])
            wait(0.35+t*0.25,()=>{ if(seg.exists()) destroy(seg) })
        }
    }
    function addLeakPool(px,py){
        // merge if within 40px of existing pool
        for(const lp of GS.leakPools){
            if(Math.hypot(lp.x-px,lp.y-py)<40){
                lp.r=Math.min(lp.r+12,90)
                return
            }
        }
        if(GS.leakPools.length<4) GS.leakPools.push({x:px,y:py,r:30,alpha:0.6})
    }

    // ── Spawn glitch ──────────────────────────────────────
    function spawnGlitch(x,y,depth){
        depth=depth||0
        if(get("glitch").length>=MAX) return
        const sz=glitchSize(), col=glitchColor()
        const gx=(x!==undefined)?Math.max(0,Math.min(x,width()-sz)):rand(10,width()-sz-10)
        const gy=(y!==undefined)?Math.max(60,Math.min(y,height()-sz)):rand(60,height()-sz-10)

        const g=add([rect(sz,sz),pos(gx,gy),color(...col),area(),opacity(0.9),scale(1),
            "glitch",{depth,baseCol:col,isGlitch:true,gravityImmune:false}])

        let fOn=true
        loop(rand(0.06,0.18),()=>{
            if(!g.exists()) return
            fOn=!fOn; g.opacity=fOn?rand(0.6,1.0):rand(0.3,0.6)
            const c=choose([col,COL.WHITE,COL.CYAN])
            g.color.r=c[0]; g.color.g=c[1]; g.color.b=c[2]
        })
        let gs2=0
        loop(0.5,()=>{
            if(!g.exists()) return
            gs2++; const s=1+Math.min(gs2*0.08,0.6)
            g.scale=vec2(s,s)
        })
        loop(rand(0.9,1.5),()=>{
            if(!g.exists()) return
            if(Math.random()<0.45+GS.corruption*0.5) spawnTendril(g.pos.x,g.pos.y)
        })
        const sd=Math.max(0.9,2.6-score*0.04)
        wait(sd,()=>{
            if(!g.exists()) return
            if(depth<3){
                try{ play("spread",{volume:0.10}) }catch(e){}
                spawnGlitch(g.pos.x+rand(-55,-15),g.pos.y+rand(-20,20),depth+1)
                spawnGlitch(g.pos.x+rand(15,55),  g.pos.y+rand(-20,20),depth+1)
                addLeakPool(g.pos.x,g.pos.y)
            }
        })
        procAdd()
        return g
    }

    // ── Auto-spawn ────────────────────────────────────────
    loop(0.5,()=>{
        const rate=Math.max(0.4,1.6-score*0.025)
        if(Math.random()<(0.5/rate)) spawnGlitch()
    })

    // ── RANK 9: Overclock powerup (golden glitch) ─────────
    function trySpawnGolden(){
        if(GS.overclockActive||bossAlive||get("glitch").length>=MAX-2) return
        const sz=20
        const gx=rand(20,width()-sz-20), gy=rand(70,height()-sz-20)
        const g=add([rect(sz,sz),pos(gx,gy),color(...COL.GOLD),area(),opacity(1),scale(1),
            "glitch",{depth:0,baseCol:COL.GOLD,isGolden:true,gravityImmune:false}])
        let gp=0
        loop(0.1,()=>{
            if(!g.exists()) return
            gp+=0.3; const s=1+Math.sin(gp)*0.2
            g.scale=vec2(s,s)
            g.color.r=COL.GOLD[0]; g.color.g=COL.GOLD[1]; g.color.b=COL.GOLD[2]
        })
        // Golden glitch disappears after 8s if not clicked
        wait(8,()=>{ if(g.exists()) destroy(g) })
    }
    loop(18,()=>{ if(score>5) trySpawnGolden() })

    // ── RANK 6: Boss Glitch ───────────────────────────────
    function spawnBoss(){
        if(bossAlive||get("glitch").length>=MAX-4) return
        bossAlive=true
        const bx=rand(80,680), by=rand(80,480)
        const boss=add([rect(60,60),pos(bx,by),color(...COL.WHITE),area(),opacity(1),scale(1),
            "glitch",{depth:0,baseCol:COL.WHITE,isBoss:true,hp:6,gravityImmune:true,isGlitch:false}])

        let bp=0
        const bCols=[COL.WHITE,COL.YELLOW,COL.MAGENTA,COL.CYAN,COL.RED,COL.ORANGE]
        loop(0.11,()=>{
            if(!boss.exists()) return
            bp+=0.45; const s=1.08+Math.sin(bp)*0.17
            boss.scale=vec2(s,s)
            const bc=bCols[Math.floor(Math.abs(Math.sin(bp))*bCols.length)]
            boss.color.r=bc[0]; boss.color.g=bc[1]; boss.color.b=bc[2]
        })

        const bLbl=add([text("HP:6",{size:14,font:"monospace"}),
            pos(bx+30,by-24),anchor("center"),color(...COL.YELLOW),fixed(),z(35)])
        boss.onUpdate(()=>{ if(bLbl.exists()) bLbl.pos=vec2(boss.pos.x+30,boss.pos.y-24) })

        // Boss accelerates corruption every 4s alive
        loop(4,()=>{
            if(!boss.exists()) return
            GS.corruption=Math.min(1,GS.corruption+0.07)
            spawnGlitch(boss.pos.x+rand(-80,80),boss.pos.y+rand(-60,60),1)
            spawnGlitch(boss.pos.x+rand(-80,80),boss.pos.y+rand(-60,60),1)
            try{ play("danger",{volume:0.14}) }catch(e){}
        })

        boss.onClick(()=>{
            if(!boss.exists()) return
            boss.hp--
            if(bLbl.exists()) bLbl.text="HP:"+boss.hp
            shake(5); try{ play("click",{volume:0.5}) }catch(e){}
            dataExplosion(boss.pos.x+30,boss.pos.y+30,COL.YELLOW,6)
            if(boss.hp<=0){
                bossAlive=false
                const bpts=(12+combo)*comboMult()
                score+=bpts; if(score>GS.highScore) GS.highScore=score
                scoreLabel.text="SCORE: "+score
                dataExplosion(boss.pos.x+30,boss.pos.y+30,COL.WHITE,14)
                dataExplosion(boss.pos.x+30,boss.pos.y+30,COL.CYAN,8)
                shake(12)
                if(bLbl.exists()) destroy(bLbl)
                destroy(boss)
                const bpop=add([text("+"+bpts+" BOSS!",{size:22,font:"monospace"}),
                    pos(boss.pos.x+30,boss.pos.y),anchor("center"),color(...COL.GOLD),opacity(1),z(52)])
                bpop.onUpdate(()=>{
                    if(!bpop.exists()) return
                    bpop.pos.y-=50*dt(); bpop.opacity-=dt()*1.8
                    if(bpop.opacity<=0) destroy(bpop)
                })
            }
        })
    }
    wait(25,function bL(){ spawnBoss(); wait(30,bL) })

    // ── RANK 4: Reality Tear Portal (anomaly slot) ────────
    function trySpawnPortal(){
        if(anomalySlot!==null||GS.corruption<0.25) return
        anomalySlot="portal"
        const ph=rand(70,130), px2=rand(50,740), py2=rand(80,520)
        const portal=add([rect(8,ph),pos(px2,py2),color(...COL.CYAN),opacity(0.9),z(6)])
        loop(0.05,()=>{
            if(!portal.exists()) return
            const gl=add([rect(rand(2,14),rand(40,ph)),
                pos(portal.pos.x+rand(-18,18),portal.pos.y),
                color(...choose([COL.CYAN,COL.MAGENTA,COL.WHITE])),opacity(rand(0.1,0.32)),z(5)])
            wait(0.09,()=>{ if(gl.exists()) destroy(gl) })
        })
        loop(0.5,()=>{
            if(!portal.exists()) return
            spawnGlitch(portal.pos.x+rand(-35,35),portal.pos.y+rand(-35,35),1)
        })
        let pfOn=true
        loop(0.09,()=>{
            if(!portal.exists()) return
            pfOn=!pfOn; portal.opacity=pfOn?rand(0.7,1.0):rand(0.3,0.6)
        })
        wait(rand(10,16),()=>{ if(portal.exists()) destroy(portal); anomalySlot=null })
    }
    loop(22,()=>{ trySpawnPortal() })

    // ── RANK 4: Gravity Well (anomaly slot, boss-excluded) ─
    function trySpawnWell(){
        if(anomalySlot!==null||GS.corruption<0.35) return
        anomalySlot="well"
        const wx=rand(80,720), wy=rand(80,500)
        const well=add([rect(22,22),pos(wx,wy),color(...COL.PURPLE),area(),opacity(0.9),scale(1),z(6)])
        let wp=0
        loop(0.08,()=>{
            if(!well.exists()) return
            wp+=0.3; const s=0.85+Math.sin(wp)*0.25
            well.scale=vec2(s,s)
            well.color.r=COL.PURPLE[0]; well.color.g=COL.PURPLE[1]; well.color.b=COL.PURPLE[2]
        })
        // Pull glitches (not boss, not immune) toward well
        loop(0.12,()=>{
            if(!well.exists()) return
            get("glitch").forEach(g=>{
                if(!g.exists()||g.gravityImmune) return
                const dx=well.pos.x-g.pos.x, dy=well.pos.y-g.pos.y
                const dist=Math.max(1,Math.hypot(dx,dy))
                if(dist<160){
                    const force=18/dist
                    g.pos.x+=dx*force*0.12
                    g.pos.y+=dy*force*0.12
                }
            })
        })
        // Player clicks well to detonate
        well.onClick(()=>{
            if(!well.exists()) return
            const wr=well.pos
            dataExplosion(wr.x+11,wr.y+11,COL.PURPLE,10)
            shake(9)
            const nearby=get("glitch").filter(g=>{
                if(!g.exists()||g.isBoss) return false
                return Math.hypot(g.pos.x-wr.x,g.pos.y-wr.y)<110
            })
            let bonus=0
            nearby.forEach(g=>{
                procKill()
                GS.ghostEchoes.push({x:g.pos.x+10,y:g.pos.y+10,sz:20,age:0,life:1.4})
                dataExplosion(g.pos.x+10,g.pos.y+10,g.baseCol,6)
                destroy(g); bonus+=comboMult()
            })
            score+=bonus; if(score>GS.highScore) GS.highScore=score
            scoreLabel.text="SCORE: "+score
            if(bonus>0){
                const wpop=add([text("+"+bonus+" SURGE",{size:20,font:"monospace"}),
                    pos(wr.x+11,wr.y),anchor("center"),color(...COL.PURPLE),opacity(1),z(52)])
                wpop.onUpdate(()=>{
                    if(!wpop.exists()) return
                    wpop.pos.y-=45*dt(); wpop.opacity-=dt()*2.2
                    if(wpop.opacity<=0) destroy(wpop)
                })
            }
            destroy(well); anomalySlot=null
        })
        wait(rand(12,18),()=>{ if(well.exists()) destroy(well); anomalySlot=null })
    }
    // Portal and well on alternating 22s cycles (offset by 11)
    wait(11,()=>{ loop(22,()=>{ trySpawnWell() }) })

    // ── RANK 1: Chain Lightning ───────────────────────────
    function doChain(originX,originY,originCol){
        const all=get("glitch").filter(g=>g.exists()&&!g.isBoss)
        const nearby=all.filter(g=>{
            const d=Math.hypot(g.pos.x-originX, g.pos.y-originY)
            return d>5 && d<160
        }).sort((a,b)=>Math.hypot(a.pos.x-originX,a.pos.y-originY)-Math.hypot(b.pos.x-originX,b.pos.y-originY))
        const targets=nearby.slice(0,3)
        targets.forEach(t=>{
            if(!t.exists()) return
            fireChain(originX,originY,t.pos.x+10,t.pos.y+10,
                Math.random()<0.5?"rgba(0,255,255,0.95)":"rgba(255,0,255,0.9)")
            GS.ghostEchoes.push({x:t.pos.x+10,y:t.pos.y+10,sz:18,age:0,life:1.2})
            // Chain kills get reduced frags (NOT precision-checked per blueprint)
            dataExplosion(t.pos.x+10,t.pos.y+10,t.baseCol||COL.CYAN,6)
            procKill()
            score+=1; if(score>GS.highScore) GS.highScore=score
            scoreLabel.text="SCORE: "+score
            destroy(t)
        })
        if(targets.length>0){
            shake(3+targets.length)
            try{ play("spread",{volume:0.3}) }catch(e){}
        }
    }

    // ── RANK 6: Precision Kill detection ─────────────────
    function isPrecision(gx,gy,gsz,mx,my){
        const hotW=gsz*0.35, hotH=gsz*0.35
        const cx=gx+gsz/2, cy=gy+gsz/2
        return Math.abs(mx-cx)<hotW && Math.abs(my-cy)<hotH
    }

    // ── Main click handler ────────────────────────────────
    onClick("glitch",(g)=>{
        if(!g.exists()) return
        if(g.isBoss) return  // boss has its own onClick

        // Overclock golden pickup
        if(g.isGolden){
            GS.overclockActive=true
            ocOverlay.opacity=0.08
            ocLabel.text="OVERCLOCK ACTIVE"
            ocLabel.opacity=1
            dataExplosion(g.pos.x+10,g.pos.y+10,COL.GOLD,12)
            shake(7)
            destroy(g)
            const myOCGen=++overclockGen
            wait(5,()=>{
                if(overclockGen!==myOCGen) return
                GS.overclockActive=false
                ocOverlay.opacity=0
                ocLabel.opacity=0
                // resume combo timer — re-arm reset at current combo
                const curGen=++comboGen
                wait(1.5,()=>{ if(comboGen===curGen){ combo=0; if(comboLabel.exists()) comboLabel.opacity=0 } })
            })
            return
        }

        const pts=calcPts()
        const px=g.pos.x, py=g.pos.y, gsz=glitchSize(), gcol=g.baseCol||COL.MAGENTA

        // Rank 6: Precision check on initiating click only
        const prec=isPrecision(px,py,20,GS.mouseX,GS.mouseY)
        const finalPts=prec?pts+2:pts
        triggerCombo()

        try{ play("click",{volume:0.45}) }catch(e){}
        shake(Math.min(4+combo,12))

        if(prec){
            const pf=add([text("PRECISION!",{size:18,font:"monospace"}),
                pos(px,py-24),anchor("center"),color(...COL.GOLD),opacity(1),z(52)])
            pf.onUpdate(()=>{
                if(!pf.exists()) return
                pf.pos.y-=45*dt(); pf.opacity-=dt()*2.0
                if(pf.opacity<=0) destroy(pf)
            })
        }

        // RANK 3: Full data explosion on primary
        dataExplosion(px+10,py+10,gcol,14)

        // RANK 7: Ghost echo (overlay, stroke only)
        if(GS.ghostEchoes.length<5) GS.ghostEchoes.push({x:px+10,y:py+10,sz:20,age:0,life:1.4})
        else { GS.ghostEchoes.shift(); GS.ghostEchoes.push({x:px+10,y:py+10,sz:20,age:0,life:1.4}) }

        const popup=add([text("+"+finalPts,{size:20,font:"monospace"}),
            pos(px,py-10),anchor("center"),color(...COL.YELLOW),opacity(1),z(50)])
        popup.onUpdate(()=>{
            if(!popup.exists()) return
            popup.pos.y-=55*dt(); popup.opacity-=dt()*2.5
            if(popup.opacity<=0) destroy(popup)
        })

        destroy(g)
        procKill()

        // RANK 1: Fire chain AFTER destroying primary
        doChain(px+10,py+10,gcol)

        score+=finalPts; if(score>GS.highScore) GS.highScore=score
        scoreLabel.text="SCORE: "+score
    })

    // ── RANK 5: UI scramble + threat update + desync ──────
    let lastDesyncPct=0, mirrorSent=false
    loop(0.07,()=>{
        if(!scoreLabel.exists()||!threatLabel.exists()) return
        scoreLabel.text=scramble("SCORE: "+score, GS.corruption)
        threatLabel.text=scramble("THREAT: "+Math.round(GS.corruption*100)+"%", GS.corruption)
    })

    loop(0.25,()=>{
        const live=get("glitch").length
        GS.corruption=live/MAX
        redrawBar(GS.corruption)
        dangerOverlay.opacity=GS.corruption>0.55?(GS.corruption-0.55)*0.35:0
        ocOverlay.opacity=GS.overclockActive?0.08:0

        // Rank 9: desync thresholds
        if(GS.corruption>=0.8 && lastDesyncPct<0.8 && !GS.desyncLocked){ triggerDesync(); lastDesyncPct=GS.corruption }
        if(GS.corruption>=0.95 && lastDesyncPct<0.95 && !GS.desyncLocked){ triggerDesync(); lastDesyncPct=GS.corruption }
        if(GS.corruption<0.75) lastDesyncPct=0

        // Rank 10: Mirror split one-time at 90%
        if(GS.corruption>=0.9 && !GS.mirrorFired && !mirrorSent){
            mirrorSent=true; GS.mirrorFired=true; GS.desyncLocked=true
            GS.mirrorAge=GS.mirrorLife
            wait(GS.mirrorLife,()=>{
                triggerDesync()
                GS.desyncLocked=false
            })
        }

        // Leak pools grow slightly each tick above 60%
        if(GS.corruption>0.6){
            GS.leakPools.forEach(lp=>{ lp.r=Math.min(lp.r+0.4,100) })
        }

        if(GS.corruption>0.72){ try{ play("danger",{volume:0.07}) }catch(e){} }
        if(live>=MAX) go("gameover",{score})
    })

    // Ambient strips
    loop(0.1,()=>{
        if(Math.random()<0.20){
            const s=add([rect(rand(40,width()),2),pos(rand(0,width()/2),rand(0,height())),
                color(...choose([COL.MAGENTA,COL.CYAN])),opacity(rand(0.04,0.09)),fixed(),z(3)])
            wait(0.1,()=>{ if(s.exists()) destroy(s) })
        }
    })
})

// =============================================================
//  SCENE: GAME OVER — Rank 3 Reboot Sequence + Rank 10 ASCII
// =============================================================
scene("gameover",({score})=>{
    GS.active=false; GS.gameOver=true
    freezeAudio()

    // Staggered queue per blueprint:
    // t=0    → freeze audio (done above)
    // t=16ms → ASCII starts
    // t=500ms → BIOS POST lines begin
    // t=2500ms → SYSTEM CRASHED appears
    // t=3000ms → score / restart appear

    wait(0,()=>{
        GS.ascii=true
        resetAscii()
    })

    addScanlines(); addCRTVignette()

    // Heavy crash strips behind ASCII
    loop(0.06,()=>{
        if(Math.random()<0.5){
            const s=add([rect(width(),rand(2,9)),pos(0,rand(0,height())),
                color(...choose([COL.MAGENTA,COL.RED,COL.CYAN])),opacity(rand(0.06,0.18)),fixed(),z(0)])
            wait(0.1,()=>{ if(s.exists()) destroy(s) })
        }
    })

    // RANK 3: Reboot sequence POST messages (text pool, 8 entries)
    const BIOS_MSGS=[
        "INITIALIZING BIOS............FAIL",
        "MEMORY TEST: 0KB / 655360KB",
        "CPU REGISTERS: CORRUPTED",
        "LOADING OS KERNEL...............",
        "KERNEL PANIC: NULL DEREFERENCE",
        "DISK I/O ERROR ON SECTOR 0xDEAD",
        "ATTEMPTING RECOVERY.....FAIL",
        "FATAL ERROR CODE: 0xC0RRUPT3D",
    ]
    const msgObjs=[]
    wait(0.5,()=>{
        BIOS_MSGS.forEach((msg,i)=>{
            wait(i*0.22,()=>{
                const m=add([text(msg,{size:11,font:"monospace"}),
                    pos(40,160+i*22),color(...COL.GREEN),opacity(0),z(98)])
                msgObjs.push(m)
                m.opacity=0.9
                wait(1.4,()=>{ if(m.exists()){ m.opacity=0.3 } })
            })
        })
    })

    wait(2.5,()=>{
        msgObjs.forEach(m=>{ if(m.exists()) m.opacity=0 })
        add([text("SYSTEM",{size:64,font:"monospace"}),
            pos(width()/2,height()/2-130),anchor("center"),color(...COL.RED),z(99)])
        add([text("CRASHED",{size:64,font:"monospace"}),
            pos(width()/2,height()/2-68),anchor("center"),color(...COL.MAGENTA),z(99)])
    })

    wait(3.0,()=>{
        add([text("FINAL SCORE: "+score,{size:24,font:"monospace"}),
            pos(width()/2,height()/2+2),anchor("center"),color(...COL.WHITE),z(99)])
        add([text("HIGH SCORE:  "+GS.highScore,{size:20,font:"monospace"}),
            pos(width()/2,height()/2+42),anchor("center"),color(...COL.YELLOW),z(99)])
        if(score>0&&score>=GS.highScore)
            add([text("* NEW HIGH SCORE *",{size:16,font:"monospace"}),
                pos(width()/2,height()/2+74),anchor("center"),color(...COL.CYAN),z(99)])

        let pv=true
        const rp=add([text("[ PRESS SPACE TO REBOOT ]",{size:18,font:"monospace"}),
            pos(width()/2,height()/2+118),anchor("center"),color(...COL.GREEN),z(99)])
        loop(0.55,()=>{ pv=!pv; rp.opacity=pv?1:0.08 })

        onKeyPress("space",()=>{ GS.ascii=false; GS.gameOver=false; go("start") })
        onMousePress(()=>{ GS.ascii=false; GS.gameOver=false; go("start") })
    })
})

// ── Boot ──────────────────────────────────────────────────────
go("start")
