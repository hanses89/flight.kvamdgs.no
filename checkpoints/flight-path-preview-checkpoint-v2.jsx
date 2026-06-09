import { useState, useEffect, useRef, useCallback } from "react";

const API = "https://discit-api.fly.dev/disc";
const BG  = "#111612";
const TRACK = "#5cd47a";

/*
  FLIGHT PATH ALGORITHM — top-down view
  Thrower at bottom-center, disc flies UP (Y decreases).
  P0 & P1 share same X → launches perfectly straight.

  hand:   'right' = RHBH, 'left' = LHBH (mirror X)
  throws: 'slow' | 'medium' | 'hard'

  Throw speed interacts with disc speed rating realistically:
  - A slow arm can't activate turn on a speed-13 driver (it just fades)
  - A fast arm fully expresses turn on any disc
  - Distance is capped per disc category (putters don't fly 160m)

  powerN values by throw:
    slow   = 0.35  — putter/midrange range, drivers barely move
    medium = 0.65  — fairway driver range, drivers moderate distance
    hard   = 1.00  — full expression for all disc types
*/

// How much turn is expressed based on throw speed vs disc speed.
// A speed-13 driver needs a hard throw to activate its turn window.
// A speed-3 putter hits its turn window even on a slow throw.
// Lower disc speed = disc spends more time in the high-speed turn phase = MORE turn expressed.
function turnActivation(discSpeed, throwSpeed) {
  const spd      = Math.max(1, Math.min(+discSpeed, 14));
  const powerN   = throwSpeed === 'slow' ? 0.30 : throwSpeed === 'medium' ? 0.60 : 1.0;
  // Threshold: how much power is needed to reach this disc's speed window
  const threshold = (spd - 1) / 13 * 0.70;
  // Base activation: does the arm meet the disc's speed?
  const base = Math.max(0, Math.min(1, (powerN - threshold) / (1 - threshold + 0.01)));
  // Inverse speed bonus: slower discs express MORE turn (they linger in turn phase longer)
  // speed 3 putter = 1.8x multiplier, speed 14 driver = 1.0x
  const speedBonus = 1.0 + (1 - (spd - 1) / 13) * 0.8;
  return Math.min(1, base * speedBonus);
}

function calcPath(speed, glide, turn, fade, W, H, hand, throwSpeed, forehand, release) {
  const isForehand = forehand === true;
  const isLeftHand = hand === 'left';
  const PAD_T = 24, PAD_B = 48;
  const cx    = W / 2;
  const yBot  = H - PAD_B;

  const speedN = Math.max(1, Math.min(+speed, 14)) / 14;
  const glideN = Math.max(1, Math.min(+glide,  7)) / 7;
  const turnV  = Math.max(-5, Math.min(+turn,  1));
  const fadeV  = Math.max(0,  Math.min(+fade,  5));

  const powerN   = throwSpeed === 'slow' ? 0.30 : throwSpeed === 'medium' ? 0.60 : 1.0;
  const turnExpr = turnActivation(speed, throwSpeed);

  // fadeStart: when does fade kick in?
  // Fast drivers hold their line longer before fading.
  // Slow putters/mids fade early even on hard throws — they bleed speed quickly.
  // Blend throw speed and disc speed: low disc speed → earlier fade
  const throwFadeStart = throwSpeed === 'slow' ? 0.72 : throwSpeed === 'medium' ? 0.80 : 0.88;
  const discFadeBonus  = (1 - speedN) * 0.18;
  const fadeStart      = Math.max(0.58, throwFadeStart - discFadeBonus);

  const throwBendStart = throwSpeed === 'slow' ? 0.45 : throwSpeed === 'medium' ? 0.50 : 0.58;
  const discBendBonus  = (1 - speedN) * 0.12;
  const bendStart      = Math.max(0.20, throwBendStart - discBendBonus);

  // Overkast-faktor: lav-speed disc kastet hardt → flyr mer rett, fader svakere
  // Zone (speed 4) kastet hardt = overkastet → nesten som flat kast, lite fade
  // Boss (speed 13) kastet hardt = normalt kastet → full fade
  // Effekten: jo større gap mellom disc speed og kastehastighet, jo mer "overkastet"
  const overcastFactor = Math.max(0, Math.min(1, powerN - speedN * 0.8));
  // Sakte kast på lav-speed disc = normalt → ingen reduksjon
  // Hardt kast på lav-speed disc = overkastet → fade reduseres betydelig
  const overcastFadeMult = 1.0 - overcastFactor * 0.75;

  const speedFadeMult = 1.0 - speedN * 0.45;
  const powerFadeMult = throwSpeed === 'slow' ? 0.55 : throwSpeed === 'medium' ? 0.75 : 1.0;

  // Release angle modifiers (RHBH backhand reference):
  // Hyzer:   disc tilted left → boosts fade, suppresses turn, starts left immediately
  // Flat:    no adjustment
  // Anhyzer: disc tilted right → boosts turn (starts right immediately), fade fights back
  const rel = release || 'flat';

  const COL           = W / 6;

  // ── Hyzer flip detection ──────────────────────────────────────
  const flipStrength = rel === 'hyzer'
    ? Math.max(0, Math.min(1, (-turnV * turnExpr * 0.35) - 0.05))
    : 0;
  const isHyzerFlip = flipStrength > 0.15;

  const hyzerMult     = isHyzerFlip       ? 0.4
                      : rel === 'hyzer'   ? 2.4
                      : rel === 'anhyzer' ? 0.3
                      : 1.0;
  const turnBoost     = isHyzerFlip       ? 0.0
                      : rel === 'anhyzer' ? 2.2
                      : rel === 'hyzer'   ? 0.15
                      : 1.0;
  const releaseOffset = isHyzerFlip       ? -COL * 0.20 * (1 - flipStrength)
                      : rel === 'anhyzer' ?  COL * 0.35
                      : rel === 'hyzer'   ? -COL * 0.35
                      : 0;

  const turnAmt = -turnV * COL * 0.40 * turnExpr * turnBoost;
  const fadeAmt = fadeV  * COL * 0.65 * speedFadeMult * powerFadeMult * hyzerMult * overcastFadeMult;

  const powerMult  = throwSpeed === 'slow' ? 0.71 : throwSpeed === 'medium' ? 0.84 : 1.0;
  const distMeters = Math.round((50 + speedN * 105 + glideN * 8) * powerMult);

  const FIXED_MAX = 160;
  const usableH   = H - PAD_T - PAD_B;
  const dist      = usableH * (distMeters / FIXED_MAX);

  const mirror = isLeftHand ? -1 : 1;

  if (isForehand) {
    // Forehand release angles are mirrored
    const fhRelOffset = rel === 'anhyzer' ? -COL * 0.35
                      : rel === 'hyzer'   ?  COL * 0.20
                      : 0;
    return {
      p0: { x: cx,                                              y: yBot },
      p1: { x: cx + mirror * fhRelOffset,                      y: yBot - dist * bendStart },
      p2: { x: cx + mirror * (-turnAmt + fhRelOffset * 0.5),   y: yBot - dist * fadeStart },
      p3: { x: cx + mirror * (-turnAmt + fadeAmt),             y: yBot - dist },
      distMeters,
    };
  }

  // Anhyzer S-curve:
  // P0 = centre (always starts straight)
  // P1 = still centre (straight launch)  
  // P2 = peaks RIGHT (anhyzer pushes disc right during flight)
  // P3 = fades LEFT from peak (overstable discs come back, understable stay right)
  // Net landing = anhyzerPeak - fadePull
  // Understable discs turn MORE on anhyzer — high neg turn = bigger peak and landing right
  // turnExpr already accounts for throw speed vs disc speed
  const underStableMult = 1 + Math.max(0, -turnV) * 0.25;  // turn -3 = 1.75x, turn 0 = 1x
  const anhyzerPeak = COL * 1.5 * (1 + turnExpr * 0.6) * underStableMult;
  const rawFadeAmt  = fadeV * COL * 0.65 * speedFadeMult * powerFadeMult;
  const stability    = fadeV + turnV;
  const stabilityN   = Math.max(0, Math.min(1, (stability - 1.5) / 4));
  const fadePull     = rawFadeAmt * 2.0 * stabilityN * (0.4 + speedN * 0.6);

  return {
    p0: { x: cx,                                            y: yBot },
    p1: rel === 'anhyzer'
      ? { x: cx,                                              y: yBot - dist * bendStart }
      : { x: cx + mirror * releaseOffset,                     y: yBot - dist * bendStart },
    p2: rel === 'anhyzer'
      ? { x: cx + mirror * anhyzerPeak,                     y: yBot - dist * fadeStart }
      : { x: cx + mirror * (turnAmt + releaseOffset * 0.5), y: yBot - dist * fadeStart },
    p3: rel === 'anhyzer'
      ? { x: cx + mirror * (anhyzerPeak - fadePull),        y: yBot - dist }
      : { x: cx + mirror * (turnAmt - fadeAmt),             y: yBot - dist },
    distMeters,
    isHyzerFlip,
  };
}

function bez(t, a, b, c, d) {
  const m = 1 - t;
  return m*m*m*a + 3*m*m*t*b + 3*m*t*t*c + t*t*t*d;
}

function pathLen(p, steps = 100) {
  let len = 0, px = p.p0.x, py = p.p0.y;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const nx = bez(t, p.p0.x, p.p1.x, p.p2.x, p.p3.x);
    const ny = bez(t, p.p0.y, p.p1.y, p.p2.y, p.p3.y);
    len += Math.hypot(nx - px, ny - py);
    px = nx; py = ny;
  }
  return len;
}

function eio(t) { return t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2; }

function drawChart(ctx, W, H, path, prog, color, hand, forehand) {
  const isForehand = forehand === true;
  const isLeftHand = hand === 'left';
  const { p0, p1, p2, p3, distMeters, isHyzerFlip } = path;
  const PAD_L = 34, cx = W / 2;
  const PAD_T = 24, PAD_B = 48;
  const gridTop = PAD_T, gridBot = H - PAD_B;
  const gridH = gridBot - gridTop;
  const FIXED_MAX = 160;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);

  // Atmosphere
  const atm = ctx.createRadialGradient(cx, 0, 0, cx, 0, H * 0.6);
  atm.addColorStop(0, 'rgba(92,212,122,0.04)'); atm.addColorStop(1, 'transparent');
  ctx.fillStyle = atm; ctx.fillRect(0, 0, W, H);

  // Grid — 5 horizontal rows = 0/40/80/120/160m
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
  for (let c = 0; c <= 6; c++) {
    const x = PAD_L + ((W - PAD_L - 14) / 6) * c;
    ctx.beginPath(); ctx.moveTo(x, gridTop); ctx.lineTo(x, gridBot); ctx.stroke();
  }
  for (let r = 0; r <= 4; r++) {
    const y = gridBot - (gridH / 4) * r;
    ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W - 14, y); ctx.stroke();
  }
  ctx.restore();

  // Y-axis labels: 0, 40, 80, 120, 160m
  ctx.save();
  ctx.fillStyle = 'rgba(232,228,220,0.55)';
  ctx.font = '8px "DM Mono","Courier New",monospace';
  ctx.textAlign = 'right';
  for (let r = 0; r <= 4; r++) {
    const y = gridBot - (gridH / 4) * r;
    const m = r * 40;
    ctx.fillText(m + 'm', PAD_L - 3, y + 3);
  }
  ctx.restore();

  // Centre dashed line
  ctx.save(); ctx.strokeStyle='rgba(255,255,255,0.12)'; ctx.lineWidth=1; ctx.setLineDash([5,10]);
  ctx.beginPath(); ctx.moveTo(cx, gridTop); ctx.lineTo(cx, gridBot); ctx.stroke(); ctx.restore();

  // Ghost glow full path
  ctx.save(); ctx.strokeStyle=color; ctx.lineWidth=8; ctx.shadowColor=color; ctx.shadowBlur=26; ctx.globalAlpha=0.10;
  ctx.beginPath(); ctx.moveTo(p0.x,p0.y); ctx.bezierCurveTo(p1.x,p1.y,p2.x,p2.y,p3.x,p3.y); ctx.stroke(); ctx.restore();

  // Animated partial path
  const total = pathLen(path), target = total * eio(prog);
  const STEPS = 240; let accum=0, prevX=p0.x, prevY=p0.y, pts=[[prevX,prevY]];
  for (let i=1; i<=STEPS; i++) {
    const t=i/STEPS, nx=bez(t,p0.x,p1.x,p2.x,p3.x), ny=bez(t,p0.y,p1.y,p2.y,p3.y);
    accum+=Math.hypot(nx-prevX,ny-prevY); pts.push([nx,ny]); prevX=nx; prevY=ny;
    if (accum>=target) break;
  }
  ctx.save(); ctx.strokeStyle=color; ctx.lineWidth=2.8; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.shadowColor=color; ctx.shadowBlur=10;
  ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]);
  for (let j=1;j<pts.length;j++) ctx.lineTo(pts[j][0],pts[j][1]);
  ctx.stroke(); ctx.restore();

  // Moving disc dot — follows the exact tip of the drawn path
  const tip = pts[pts.length - 1];
  const dx = tip[0], dy = tip[1];
  ctx.save(); ctx.shadowColor=color; ctx.shadowBlur=18; ctx.fillStyle='#fff';
  ctx.beginPath(); ctx.arc(dx,dy,7,0,Math.PI*2); ctx.fill(); ctx.strokeStyle=color; ctx.lineWidth=1.5; ctx.stroke(); ctx.restore();

  // Arrowhead at landing
  if (prog>=1) {
    const t2=0.984, ax=bez(t2,p0.x,p1.x,p2.x,p3.x), ay=bez(t2,p0.y,p1.y,p2.y,p3.y);
    const angle=Math.atan2(p3.y-ay,p3.x-ax), al=13;
    ctx.save(); ctx.strokeStyle=color; ctx.lineWidth=2.2; ctx.globalAlpha=0.85; ctx.shadowColor=color; ctx.shadowBlur=8;
    ctx.beginPath();
    ctx.moveTo(p3.x-Math.cos(angle-0.4)*al, p3.y-Math.sin(angle-0.4)*al);
    ctx.lineTo(p3.x,p3.y);
    ctx.lineTo(p3.x-Math.cos(angle+0.4)*al, p3.y-Math.sin(angle+0.4)*al);
    ctx.stroke(); ctx.restore();
  }

  const sub='rgba(232,228,220,0.65)';
  ctx.save(); ctx.fillStyle=sub; ctx.font='9px "DM Mono","Courier New",monospace';
  const leftLabel  = isLeftHand
    ? (isForehand ? '← Fade' : 'Turn ←')
    : (isForehand ? 'Turn ←' : '← Fade');
  const rightLabel = isLeftHand
    ? (isForehand ? 'Turn →' : '→ Fade')
    : (isForehand ? '→ Fade' : 'Turn →');
  ctx.textAlign='left';  ctx.fillText(leftLabel,  PAD_L, 18);
  ctx.textAlign='right'; ctx.fillText(rightLabel, W-10, 18);
  ctx.textAlign='center'; ctx.fillText('Utkast', cx, H - 8);
  if (prog > 0.88) {
    ctx.globalAlpha = Math.min((prog - 0.88) / 0.12, 1);
    const landY = p3.y < 36 ? p3.y + 16 : p3.y - 10;
    ctx.fillText(`${distMeters}m`, p3.x, landY);
  }
  // Hyzer flip badge
  if (isHyzerFlip) {
    ctx.globalAlpha = Math.min(prog * 3, 1);
    ctx.fillStyle = '#f0b84a';
    ctx.font = '600 9px "DM Mono","Courier New",monospace';
    ctx.textAlign = 'center';
    ctx.fillText('⚡ Hyzer Flip', cx, 34);
  }
  ctx.globalAlpha=0.25; ctx.fillStyle='#fff';
  ctx.beginPath(); ctx.arc(p0.x,p0.y,3.5,0,Math.PI*2); ctx.fill();
  ctx.restore();
}

// ── Sub-components ──────────────────────────────────────────

function HandToggle({ hand, forehand, onChange, isMobile }) {
  const suffix = forehand ? 'FH' : 'BH';
  const btn = (val, labelFull, labelShort, icon) => (
    <button onClick={() => onChange(val)} style={{
      flex:1, padding:'7px 6px', borderRadius:6, cursor:'pointer', fontFamily:'inherit',
      fontSize: isMobile ? 9 : 10, letterSpacing:'0.04em', display:'flex', alignItems:'center', justifyContent:'center', gap:4,
      background: hand===val ? 'rgba(92,212,122,0.18)' : 'rgba(255,255,255,0.05)',
      border: `1px solid ${hand===val ? 'rgba(92,212,122,0.5)' : 'rgba(255,255,255,0.1)'}`,
      color: hand===val ? '#e8e4dc' : 'rgba(232,228,220,0.5)',
      transition:'all 0.15s',
    }}>
      <span style={{ fontSize:13 }}>{icon}</span>
      {isMobile ? labelShort : labelFull}{suffix})
    </button>
  );
  return (
    <div>
      <div style={{ fontSize:9, letterSpacing:'0.15em', textTransform:'uppercase', color:'rgba(232,228,220,0.38)', marginBottom:6 }}>Hånd</div>
      <div style={{ display:'flex', gap:6 }}>
        {btn('right', 'Høyrehånds (RH', 'Høyre (RH', '🤜')}
        {btn('left',  'Venstrehånds (LH', 'Venstre (LH', '🤛')}
      </div>
    </div>
  );
}

function ThrowToggle({ value, onChange }) {
  const opts = [
    { val: 'slow',   label: 'Sakte'   },
    { val: 'medium', label: 'Middels' },
    { val: 'hard',   label: 'Hardt'   },
  ];
  return (
    <div>
      <div style={{ fontSize:9, letterSpacing:'0.15em', textTransform:'uppercase', color:'rgba(232,228,220,0.38)', marginBottom:6 }}>Kastehastighet</div>
      <div style={{ display:'flex', gap:5 }}>
        {opts.map(o => (
          <button key={o.val} onClick={() => onChange(o.val)} style={{
            flex:1, padding:'7px 4px', borderRadius:6, cursor:'pointer', fontFamily:'inherit',
            display:'flex', alignItems:'center', justifyContent:'center',
            background: value===o.val ? 'rgba(92,212,122,0.18)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${value===o.val ? 'rgba(92,212,122,0.5)' : 'rgba(255,255,255,0.1)'}`,
            color: value===o.val ? '#e8e4dc' : 'rgba(232,228,220,0.45)',
            transition:'all 0.15s',
          }}>
            <span style={{ fontSize:11, fontWeight:600 }}>{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ReleaseToggle({ value, onChange }) {
  const opts = [
    { val: 'hyzer',   label: 'Hyzer',   desc: '↙' },
    { val: 'flat',    label: 'Flat',    desc: '→'  },
    { val: 'anhyzer', label: 'Anhyzer', desc: '↗'  },
  ];
  return (
    <div>
      <div style={{ fontSize:9, letterSpacing:'0.15em', textTransform:'uppercase', color:'rgba(232,228,220,0.38)', marginBottom:6 }}>Vinkel</div>
      <div style={{ display:'flex', gap:5 }}>
        {opts.map(o => (
          <button key={o.val} onClick={() => onChange(o.val)} style={{
            flex:1, padding:'7px 4px', borderRadius:6, cursor:'pointer', fontFamily:'inherit',
            display:'flex', flexDirection:'column', alignItems:'center', gap:2,
            background: value===o.val ? 'rgba(92,212,122,0.18)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${value===o.val ? 'rgba(92,212,122,0.5)' : 'rgba(255,255,255,0.1)'}`,
            color: value===o.val ? '#e8e4dc' : 'rgba(232,228,220,0.45)',
            transition:'all 0.15s',
          }}>
            <span style={{ fontSize:13 }}>{o.desc}</span>
            <span style={{ fontSize:10, fontWeight:600 }}>{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function StatBadge({ label, value, color }) {
  return (
    <div style={{ textAlign:'center' }}>
      <div style={{ fontSize:9, letterSpacing:'0.14em', textTransform:'uppercase', color:'rgba(232,228,220,0.35)', fontFamily:'inherit', marginBottom:2 }}>{label}</div>
      <div style={{ fontSize:20, fontWeight:700, color:'#e8e4dc', lineHeight:1, textShadow:`0 0 12px ${color}44` }}>{value}</div>
    </div>
  );
}

function DiscResult({ disc, onSelect, selected }) {
  const stability = disc.stability || '';
  const stabColor = stability.includes('Very Over') ? '#e05c5c'
    : stability.includes('Over') ? '#f0a050'
    : stability.includes('Under') ? '#5cd47a'
    : '#8ec8f0';
  return (
    <button onClick={() => onSelect(disc)} style={{
      background: selected ? 'rgba(92,212,122,0.12)' : 'rgba(255,255,255,0.04)',
      border: `1px solid ${selected ? 'rgba(92,212,122,0.45)' : 'rgba(255,255,255,0.08)'}`,
      borderRadius:8, padding:'8px 10px', cursor:'pointer', textAlign:'left',
      fontFamily:'inherit', transition:'all 0.15s', width:'100%',
    }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
        <div>
          <div style={{ fontSize:11, fontWeight:600, color:'#e8e4dc', marginBottom:1 }}>{disc.name}</div>
          <div style={{ fontSize:9, color:'rgba(232,228,220,0.42)', letterSpacing:'0.05em' }}>{disc.brand}</div>
        </div>
        <div style={{ display:'flex', gap:5, alignItems:'center', flexShrink:0 }}>
          <span style={{ fontSize:9, color:stabColor, background:`${stabColor}18`, border:`1px solid ${stabColor}44`, borderRadius:4, padding:'1px 5px', letterSpacing:'0.04em' }}>{disc.stability}</span>
          <span style={{ fontSize:10, color:'rgba(232,228,220,0.5)', fontFamily:'inherit' }}>{disc.speed}/{disc.glide}/{disc.turn}/{disc.fade}</span>
        </div>
      </div>
    </button>
  );
}

// ── Main app ─────────────────────────────────────────────────
export default function FlightPathApp() {
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [hand, setHand]             = useState('right');
  const [throwSpeed, setThrowSpeed] = useState('medium');
  const [forehand, setForehand]     = useState(false);
  const [release, setRelease]       = useState('flat');

  const canvasRef = useRef(null);
  const rafRef    = useRef(null);
  const startRef  = useRef(null);
  const debSearch = useRef(null);
  const debAnim   = useRef(null);

  const [isMobile, setIsMobile] = useState(window.innerWidth < 420);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 420);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const W = Math.round(rect.width  || 420);
    const H = Math.round(rect.height || 560);
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
  }, []);

  // Search
  const search = useCallback(async (q) => {
    if (!q || q.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const r = await fetch(`${API}?name=${encodeURIComponent(q)}`);
      const data = await r.json();
      setResults(Array.isArray(data) ? data.slice(0, 20) : []);
    } catch { setResults([]); }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (debSearch.current) clearTimeout(debSearch.current);
    debSearch.current = setTimeout(() => search(query), 350);
  }, [query, search]);

  // Animation — takes all params explicitly to avoid stale closure
  const runAnim = useCallback((disc, h, ts, fh, rel) => {
    if (!disc || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width  / dpr;
    const H = canvas.height / dpr;
    const ctx = canvas.getContext('2d');
    const path = calcPath(disc.speed, disc.glide, disc.turn, disc.fade, W, H, h, ts, fh === true, rel);
    const duration = 1800 + (Math.min(+disc.speed,14)/14) * 800;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    startRef.current = null;
    function frame(timestamp) {
      if (!startRef.current) startRef.current = timestamp;
      const prog = Math.min((timestamp - startRef.current) / duration, 1);
      drawChart(ctx, W, H, path, prog, TRACK, h, fh === true);
      if (prog < 1) rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);
  }, []);

  // Debounce re-animation when power/hand changes
  useEffect(() => {
    if (!selected) return;
    if (debAnim.current) clearTimeout(debAnim.current);
    debAnim.current = setTimeout(() => runAnim(selected, hand, throwSpeed, forehand, release), 60);
  }, [selected, hand, throwSpeed, forehand, release, runAnim]);

  useEffect(() => { return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }; }, []);

  // Empty state canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || selected) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width / dpr, H = canvas.height / dpr, cx = W/2;
    ctx.fillStyle = BG; ctx.fillRect(0,0,W,H);
    ctx.save(); ctx.strokeStyle='rgba(255,255,255,0.04)'; ctx.lineWidth=1;
    for(let c=0;c<=6;c++){const x=36+((W-72)/6)*c;ctx.beginPath();ctx.moveTo(x,16);ctx.lineTo(x,H-20);ctx.stroke();}
    for(let r=0;r<=5;r++){const y=24+((H-46)/5)*r;ctx.beginPath();ctx.moveTo(16,y);ctx.lineTo(W-16,y);ctx.stroke();}
    ctx.restore();
    ctx.save(); ctx.strokeStyle='rgba(255,255,255,0.10)'; ctx.lineWidth=1; ctx.setLineDash([5,10]);
    ctx.beginPath(); ctx.moveTo(cx,16); ctx.lineTo(cx,H-18); ctx.stroke(); ctx.restore();
    ctx.save(); ctx.fillStyle='rgba(232,228,220,0.16)'; ctx.font='11px "DM Mono","Courier New",monospace';
    ctx.textAlign='center'; ctx.fillText('Søk etter en disc for å se flybanen', cx, H/2); ctx.restore();
  }, [selected]);

  const handleSelect = (disc) => {
    setSelected(disc);
    setResults([]);
    setQuery(disc.name);
  };

  const nums = selected ? [
    ['Speed', selected.speed, TRACK],
    ['Glide', selected.glide, '#8ec8f0'],
    ['Turn',  selected.turn,  '#f0b84a'],
    ['Fade',  selected.fade,  '#e05c5c'],
  ] : null;

  return (
    <div style={{ minHeight:'100vh', background:'#0a0c0a', display:'flex', alignItems:'flex-start', justifyContent:'center', padding: isMobile ? '12px 8px' : '20px 14px', fontFamily:'"DM Mono","Courier New",monospace' }}>
      <div style={{ width:'100%', maxWidth:480 }}>

        <div style={{ background:BG, borderRadius: isMobile ? 10 : 16, padding: isMobile ? '14px 12px' : '20px 20px 20px', border:'1px solid rgba(255,255,255,0.07)', boxShadow:'0 28px 80px rgba(0,0,0,0.7)', position:'relative', overflow:'hidden' }}>
          <div style={{ position:'absolute', inset:0, pointerEvents:'none', background:'radial-gradient(ellipse 55% 28% at 50% 0%, rgba(92,212,122,0.06) 0%, transparent 70%)' }} />

          {/* Header row */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14, position:'relative', zIndex:1 }}>
            <span style={{ fontSize:9, fontWeight:600, letterSpacing:'0.22em', textTransform:'uppercase', color:'rgba(232,228,220,0.30)' }}>Flybane</span>
            {selected && (
              <div style={{ display:'flex', gap:16 }}>
                {nums.map(([l,v,c]) => <StatBadge key={l} label={l} value={v} color={c} />)}
              </div>
            )}
          </div>

          {/* Disc name */}
          {selected && (
            <div style={{ marginBottom:12, position:'relative', zIndex:1 }}>
              <div style={{ fontSize:16, fontWeight:700, color:'#e8e4dc', letterSpacing:'-0.01em' }}>{selected.name}</div>
              <div style={{ fontSize:10, color:'rgba(232,228,220,0.40)', marginTop:2 }}>
                {selected.brand} · {selected.category} ·{' '}
                <span style={{ color: selected.stability?.includes('Under') ? TRACK : selected.stability?.includes('Over') ? '#e05c5c' : '#8ec8f0' }}>
                  {selected.stability}
                </span>
              </div>
            </div>
          )}

          {/* Canvas */}
          <div style={{ borderRadius:10, overflow:'hidden', aspectRatio:'3/4', width:'100%', position:'relative', zIndex:1 }}>
            <canvas ref={canvasRef} style={{ display:'block', width:'100%', height:'100%' }} />
            <div style={{ position:'absolute', bottom:8, right:10, display:'flex', alignItems:'center', gap:8 }}>
              {/* Replay button */}
              {selected && (
                <button
                  onClick={() => runAnim(selected, hand, throwSpeed, forehand, release)}
                  title="Spill av igjen"
                  style={{
                    background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.15)',
                    borderRadius:6, width:26, height:26, cursor:'pointer',
                    display:'flex', alignItems:'center', justifyContent:'center',
                    color:'rgba(232,228,220,0.7)', fontSize:12,
                    transition:'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background='rgba(92,212,122,0.2)'; e.currentTarget.style.borderColor='rgba(92,212,122,0.5)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background='rgba(255,255,255,0.08)'; e.currentTarget.style.borderColor='rgba(255,255,255,0.15)'; }}
                >
                  ↺
                </button>
              )}
              <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                <div style={{ width:6, height:6, borderRadius:'50%', background:'#fff', boxShadow:'0 0 4px #fff' }} />
                <span style={{ fontSize:9, color:'rgba(232,228,220,0.30)', textTransform:'uppercase', letterSpacing:'0.1em' }}>
                  {hand==='right' ? 'RH' : 'LH'}{forehand ? 'FH' : 'BH'}
                </span>
              </div>
            </div>
          </div>

          {/* Controls below canvas */}
          <div style={{ marginTop:16, display:'flex', flexDirection:'column', gap:14, position:'relative', zIndex:1 }}>

            {/* Hand toggle */}
            <HandToggle hand={hand} forehand={forehand} onChange={setHand} isMobile={isMobile} />

            {/* Kastetype + Kastehastighet */}
            <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : 'auto 1fr', gap:14, alignItems:'start' }}>
              {/* Forehand/Backhand toggle */}
              <div>
                <div style={{ fontSize:9, letterSpacing:'0.15em', textTransform:'uppercase', color:'rgba(232,228,220,0.38)', marginBottom:6 }}>Kastetype</div>
                <div style={{ display:'flex', gap:5 }}>
                  {[{ val: false, label: 'Backhand' }, { val: true, label: 'Forehand' }].map(o => (
                    <button key={String(o.val)} onClick={() => setForehand(o.val)} style={{
                      flex:1, padding:'7px 6px', borderRadius:6, cursor:'pointer', fontFamily:'inherit',
                      fontSize:11, fontWeight:600,
                      background: forehand===o.val ? 'rgba(92,212,122,0.18)' : 'rgba(255,255,255,0.05)',
                      border: `1px solid ${forehand===o.val ? 'rgba(92,212,122,0.5)' : 'rgba(255,255,255,0.1)'}`,
                      color: forehand===o.val ? '#e8e4dc' : 'rgba(232,228,220,0.45)',
                      transition:'all 0.15s',
                    }}>{o.label}</button>
                  ))}
                </div>
              </div>
              <ThrowToggle value={throwSpeed} onChange={setThrowSpeed} />
            </div>

            {/* Release angle */}
            <ReleaseToggle value={release} onChange={setRelease} />

            {/* Search */}
            <div>
              <div style={{ position:'relative' }}>
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Søk disc (Boss, Destroyer, Buzzz…)"
                  style={{
                    width:'100%', boxSizing:'border-box',
                    background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.12)',
                    borderRadius:8, padding:'9px 36px 9px 12px',
                    color:'#e8e4dc', fontSize:11, fontFamily:'inherit', outline:'none',
                    transition:'border-color 0.15s',
                  }}
                  onFocus={e=>e.target.style.borderColor='rgba(92,212,122,0.45)'}
                  onBlur={e =>e.target.style.borderColor='rgba(255,255,255,0.12)'}
                />
                {loading && (
                  <div style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', width:14, height:14, borderRadius:'50%', border:'2px solid rgba(92,212,122,0.25)', borderTopColor:TRACK, animation:'spin 0.7s linear infinite' }} />
                )}
              </div>

              {results.length > 0 && (
                <div style={{ marginTop:6, display:'flex', flexDirection:'column', gap:4, maxHeight:200, overflowY:'auto', paddingRight:2 }}>
                  {results.map(d => (
                    <DiscResult key={d.id} disc={d} onSelect={handleSelect} selected={selected?.id===d.id} />
                  ))}
                </div>
              )}

              {query.length >= 2 && !loading && results.length === 0 && (
                <div style={{ marginTop:6, fontSize:10, color:'rgba(232,228,220,0.30)', textAlign:'center', padding:'8px 0' }}>
                  Ingen discer funnet for "{query}"
                </div>
              )}
            </div>
          </div>
        </div>

        <p style={{ textAlign:'center', marginTop:10, fontSize:9, color:'rgba(255,255,255,0.13)', letterSpacing:'0.1em', textTransform:'uppercase' }}>
          Data fra discit-api · 10 000+ discer
        </p>
      </div>

      <style>{`@keyframes spin { to { transform:translateY(-50%) rotate(360deg); } }`}</style>
    </div>
  );
}
