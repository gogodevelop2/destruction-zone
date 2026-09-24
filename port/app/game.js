// 조립한 게임 — 옮긴 함수들을 이어 main 부터 돌린다. Node(run.ts, 락스텝)와 브라우저(web/worker.ts)가 같이 쓴다.
//
// 옮긴 함수는 그대로 부른다. 아직 없는 기능은 gap(이름) 으로 부른 횟수를 세고 건너뛴다.
// 값을 돌려줘야 하는 자리에서 기능이 없으면 멈춘다.
//
// 기계 층은 최소만 둔다. DGROUP 64KiB, VGA 레지스터 값 표, 화면 메모리 A000/A800 두 쪽,
// DAC 256칸, rom/ 의 파일 읽기. BGI 화면 800x600 은 raster.ts (SVGA16.GDA 를 옮긴 것) 다.
//
// BGI 껍데기(EXE 세그먼트 0x140B, 라이브러리라 옮기지 않았다)는 건너뛰고 드라이버에 곧바로
// 잇는다. 뷰포트가 화면 전체이고 잘라 낼 일이 없다고 가정한 것이다 — 판정은 락스텝 대조가 한다.
// 인자 모양은 analysis/graphics_bgi.md 의 진입점 표 (line·bar·rectangle 은 x1,y1,x2,y2).
//
// 하드웨어와 시간은 GameEnv 로 받는다 — 파일, 포트 0x60, BIOS 키 버퍼(kbhit/getch), 대기, 소리.
// @원본 없음 — 도구
import { state as randState, randStep } from "../lib/rand.js";
import { runMain,               } from "../lib/main.js";
import { runGameLoop,                   } from "../lib/game_loop.js";
import { runRoundSetup } from "../lib/round_setup.js";
import { startupSeedAndSpeedCalibration, calibrationMultiplier, calibrationScale } from "../lib/startup_calibration.js";
import { startupGreetingOrShareware,                    } from "../lib/startup_greeting.js";
import { graphicsInitOrMode,                } from "../lib/graphics_init.js";
import { enterModeX,                } from "../lib/mode_x.js";
import { imageLoadToSecondPage, imageDrawRle320x400, imageRedrawWindow320x400,                    } from "../lib/mode_x_image.js";
import { runMainMenu, drawMissionScreen,               } from "../lib/menu_screen.js";
import { runResultScreen, resultScreenTextCell,            } from "../lib/result_screen.js";
import { labelledPanel, rectOutline, drawString as vramString, textInputPrompt } from "../lib/vram.js";
import { loadPaletteFromFile, roundPalette } from "../lib/palette.js";
import { matchSetup } from "../lib/match_setup.js";
import { sampleKeyboard } from "../lib/keyboard.js";
import { scancodeToPlayerInput } from "../lib/scancode_dispatch.js";
import { runAutopilot } from "../lib/robot_autopilot.js";
import { updateObjects,                       } from "../lib/object_update.js";
import { ObjectArray } from "../lib/objects.js";
import { tankColourFlashAndRespawn } from "../lib/tank_respawn.js";
import { updateMarkers } from "../lib/markers.js";
import { drawStatusPanelBlock,                } from "../lib/status_panel.js";
import { changeWeapon, runFire,                                } from "../lib/weapon.js";
import { escQuitAward } from "../lib/esc_award.js";
import { probe, isRectangleClear,             } from "../lib/line_probe.js";
import { runTankMove,                   } from "../lib/tank_move.js";
import { Raster } from "../lib/raster.js";
import { drawTank } from "../lib/tank_draw.js";
import { drawString } from "../lib/text.js";
import { runArenaLayout,                } from "../lib/arena_layout.js";
import { runShopScreen,               } from "../lib/shop.js";
import { calibratedBusyWait } from "../lib/wait.js";
                                              

/** 게임 밖에서 받는 것. 없는 것은 gap 으로 센다. */
                          
                                           
                                                                  
                                                           
                                                                  
                          
                                                            
                                                
                                                                
                                                                                 
                           
                   
                                                       
                                                                                    
                                                            
                   
                       
                          
                                            
                                                       
 

export class Stop extends Error {}
/** 메뉴의 LEAVE GAME(0x13EED: 글자 모드로 되돌리고 exit(1)). 오류가 아니라 프로그램이 정상으로 끝난 것이다. */
export class Quit extends Stop {}
const LOAD_SEG = 0x1f5;                 // profile.yaml 의 로드 세그먼트 (실측)
// DZONE.EXE 의 MZ 재배치 표 가운데 DGROUP 안에 떨어지는 8곳 (port/data/extract.ts 가 꺼내고 data.test.ts 가 대조한다)
export const DGROUP_RELOCS = [0x262e, 0x27cb, 0x27cf, 0x3086, 0x308a, 0x308e, 0x3398, 0x33a4];
const u16le = (b            , o        ) => b[o] | (b[o + 1] << 8);
const i16 = (v        ) => (v << 16) >> 16;
const s8 = (v        ) => (v << 24) >> 24;

export function createGame(env         ) {
  const ls = env.ls ?? null;
  const readRom = env.readRom;

  // ── 빠진 것을 세는 곳 ───────────────────────────────────────────────────────
  const gaps = new Map                ();
  const gap = (name        )       => { gaps.set(name, (gaps.get(name) ?? 0) + 1); };
  const need = (name        )        => { gap(name); throw new Stop(`없음: ${name}`); };

  // ── DGROUP — 초기값 0x33AC 바이트(port/data/DGROUP.BIN), 나머지는 0. 재배치 8워드에 로드 세그먼트를 더한다
  const dg = (() => {
    const dg = new Uint8Array(0x10000);
    dg.set(readRom("DGROUP.BIN") );
    for (const a of DGROUP_RELOCS) { const v = (u16le(dg, a) + LOAD_SEG) & 0xffff; dg[a] = v & 0xff; dg[a + 1] = v >> 8; }
    return dg;
  })();
  const dv = new DataView(dg.buffer);
  const wr16 = (a        , v        ) => dv.setUint16(a, v & 0xffff, true);
  const seedToDg = () => { wr16(0x3268, randState.seed); wr16(0x326a, randState.seed >>> 16); };

  // ── 기계 ──────────────────────────────────────────────────────────────────
  const vgaRegs = new Map                ();           // 포트(+색인) → 값
  const vgaIndex = new Map                ();
  const vram = new Uint8Array(4 * 0x10000);            // 평면 4 × 64KiB (A000 과 A800 을 함께 담는다)
  const dac = new Uint8Array(256 * 3);
  const raster = new Raster();                          // BGI 화면 800x600 16색
  const display = { mode: "text"                             };
  const screen         = { getPixel: (x, y) => raster.getPixel(x, y) };
  // 선 탐침 0x046CA
  const probeS = (x1        , y1        , x2        , y2        , n        , c1        , c2        , c3        )         => {
    const r = probe(screen, x1, y1, x2, y2, n, c1, c2, c3);
    env.onProbe?.([x1, y1, x2, y2, n, c1, c2, c3], r);
    return r;
  };
  let mapMask = 0x0f;

  const modeX            = {
    int10: (ax) => gap(`INT 10h AX=${ax.toString(16)}`),
    outb: (port, v) => {
      if (port === 0x3c4 || port === 0x3ce || port === 0x3d4) vgaIndex.set(port, v);
      else vgaRegs.set(port * 256 + (vgaIndex.get(port - 1) ?? 0), v);
      if (port === 0x3c5 && vgaIndex.get(0x3c4) === 2) mapMask = v & 0x0f;
    },
    inb: (port) => vgaRegs.get(port * 256 + (vgaIndex.get(port - 1) ?? 0)) ?? 0,
    outw: (port, v) => { modeX.outb(port, v & 0xff); modeX.outb(port + 1, v >> 8); },
    clearByte: (seg, off) => { for (let p = 0; p < 4; p++) if (mapMask & (1 << p)) vram[p * 0x10000 + ((seg - 0xa000) * 16 + off) % 0x10000] = 0; },
  };
  const enterX = (a        ) => { enterModeX(a, modeX); display.mode = "modex"; };

  // BGI 라이브러리(세그먼트 0x140B, 옮기지 않았다)가 initgraph 에서 드라이버 파일을 DGROUP 의 근거리 힙에 올린다.
  // 원본 덤프(robots5_30r_wide_v1 프레임 84·3401, devlog 122)에서 잰 모양: 파일 전체를 0x53BC 에 읽고, 머리(0xA0바이트)
  // 뒤의 코드를 문단 경계 0x5450(= 드라이버 cs 0x21E0)으로 12바이트 당긴다. 이렇게 만든 6,803바이트 중 43바이트만 원본과
  // 다르다(드라이버 변수와 로더가 고친 자리). 게임 논리가 이것을 읽는 길이 있다 — 오토파일럿이 초기화하지 않은 칸에서 얻은
  // 탱크 번호(예: 19)로 탱크 표 밖을 읽으면 이 코드 바이트가 좌표가 된다.
  function loadSvga16Driver()       {
    const drv = readRom("SVGA16.GDA") ;
    dg.set(drv, 0x53bc);
    dg.copyWithin(0x5450, 0x53bc + 0xa0, 0x53bc + drv.length);
  }
  function applyGfx(effects             )       {
    let svga16 = false;
    for (const e of effects) {
      if (e.kind === "writeWord") wr16(e.addr, e.value);
      else if (e.kind === "bgi" && e.entry === "installuserdriver") { svga16 = true; gap(`BGI ${e.entry}`); }
      else if (e.kind === "bgi" && e.entry === "initgraph" && svga16) { loadSvga16Driver(); display.mode = "bgi"; }
      else if (e.kind === "bgi") { gap(`BGI ${e.entry}`); if (e.entry === "setgraphmode") display.mode = "bgi"; }
      else gap(`near call ${e.target.toString(16)}`);
    }
  }
  function applyStartup(effects                 )       {
    for (const e of effects) gap(`시작 화면 효과 ${e.kind}`);
  }

  // ── BGI — 드라이버 함수 4·5·6·9·15 에 곧바로 잇는다 ───────────────────────────
  let colour = 15, fillColour = 15;
  const bgi = {
    // BGI 라이브러리는 현재 색을 DGROUP 0x2850 에, 현재 점을 0x2855·0x2857 에 적는다 (tank_move_full.test.ts)
    setcolor: (c        ) => { colour = c & 0xff; dg[0x2850] = colour; },
    setfillstyle: (pattern        , c        ) => { if ((pattern & 0xff) !== 1) gap("BGI 채움 무늬 1 이 아님"); fillColour = c & 0xff; },
    line: (x1        , y1        , x2        , y2        ) => raster.line(i16(x1), i16(y1), i16(x2), i16(y2), colour),
    bar: (x1        , y1        , x2        , y2        ) => raster.bar(i16(x1), i16(y1), i16(x2), i16(y2), fillColour),
    rectangle: (x1        , y1        , x2        , y2        ) => {
      bgi.line(x1, y1, x2, y1); bgi.line(x2, y1, x2, y2); bgi.line(x2, y2, x1, y2); bgi.line(x1, y2, x1, y1);
    },
    moveTo: (x        , y        ) => { raster.moveTo(i16(x), i16(y)); wr16(0x2855, x); wr16(0x2857, y); },
    lineTo: (x        , y        ) => { raster.lineTo(i16(x), i16(y), colour); wr16(0x2855, x); wr16(0x2857, y); },
  };
  // 0x136ED drawString 의 문자열은 DGROUP 기준 근거리 오프셋이다 (0x13704 mov al,[bx+di])
  const dgString = (off        ) => { const a = off & 0xffff; let e = a; while (dg[e & 0xffff]) e++; return dg.subarray(a, e); };
  const put = (x        , y        , c        ) => raster.putPixel(x, y, c);
  const sound = (hz        ) => (env.sound ? env.sound(hz) : gap("소리"));
  const nosound = () => (env.nosound ? env.nosound() : gap("소리"));

  // 0x0F256 — 레코드에서 삼각형을 꺼내 그린다. 색은 DGROUP 0x126F[t]
  const tankAt = (t        ) => 0x43fc + s8(t) * 0x176;
  const drawTankLive = (t        , erase        ) => {
    const b = tankAt(t);
    drawTank(raster, {
      posX: dv.getInt32(b + 0x09, true), posY: dv.getInt32(b + 0x0d, true), destroyed: dg[b + 0x02],
      vx: [s8(dg[b + 0x41]), s8(dg[b + 0x42]), s8(dg[b + 0x43])], vy: [s8(dg[b + 0x45]), s8(dg[b + 0x46]), s8(dg[b + 0x47])],
      strokeX1: dv.getInt16(b + 0x15, true), strokeY1: dv.getInt16(b + 0x17, true),
      strokeX2: dv.getInt16(b + 0x19, true), strokeY2: dv.getInt16(b + 0x1b, true),
    }, dg[0x126f + s8(t)], erase);
  };

  // markers·tank_respawn 은 rand.ts 의 전역 씨앗을 쓰고 나머지는 DGROUP 0x3268 을 쓴다. 앞뒤로 옮긴다.
  const withGlobalRand =    (f         )    => { randState.seed = dv.getUint32(0x3268, true); const r = f(); seedToDg(); return r; };

  const panel            = {
    setfillstyle: bgi.setfillstyle, setcolor: bgi.setcolor, line: bgi.line, bar: bgi.bar,
    drawString: (x, y, p, c) => drawString(i16(x), i16(y), dgString(p), c & 0xff, put),
  };
  const weaponHost             = { statusPanel: (m, p) => drawStatusPanelBlock(panel, dg, m, p) };
  const fireHost           = {
    ...weaponHost,
    setColor: bgi.setcolor, line: bgi.line,
    probe: (a) => probeS(a.x1, a.y1, a.x2, a.y2, a.count, a.c1, a.c2, a.c3),
  };
  const arr = new ObjectArray(dg);

  // ── 키보드 표본기 0x0AEB8 — 포트 0x60 을 읽어 링 0x4D90 에 넣는다
  const keySample = () => {
    const ring = { writeIndex: dg[0x4d90], at: dg.subarray(0x4d91) };
    sampleKeyboard(ring, () => env.port("game"));
    dg[0x4d90] = ring.writeIndex;
  };

  const objectHost                   = {
    ...fireHost, sampleKeyboard: keySample,
    moveTo: bgi.moveTo, lineTo: bgi.lineTo,
    sound, nosound,
    drawTank: drawTankLive,
    tankMove: (a) => tankMove(a, 0xff9c),   // 0x1001C 에서 부를 때의 BP
  };

  // 0x0E128 — 탱크 이동과 그리기
  const tankMoveHost               = {
    sampleKeyboard: () => keySample(),
    probe: (x1, y1, x2, y2, n, c1, c2, c3) => probeS(x1, y1, x2, y2, n, c1, c2, c3),
    setcolor: (c) => bgi.setcolor(c), moveTo: (x, y) => bgi.moveTo(x, y), lineTo: (x, y) => bgi.lineTo(x, y),
    line: (x1, y1, x2, y2) => bgi.line(x1, y1, x2, y2), getPixel: (x, y) => raster.getPixel(x, y),
    drawTank: (t, e) => drawTankLive(t, e),
  };
  // 부르는 곳마다 BP 가 다르다 (원본에서 잰 값, devlog 114). 탱크 이동의 지역 일부가 오토파일럿이 읽는 자리와 겹친다.
  const tankMove = (a        , bp        ) => runTankMove(tankMoveHost, dg, a, bp);

  // ── 경기장 배치 — 호출을 그 자리에서 실행하고 탐침은 이 화면을 읽는다 ───────────
  const arenaLive = {
    exec: (c           ) => {
      switch (c.fn) {
        case "setfillstyle": return bgi.setfillstyle(...c.args);
        case "bar": return bgi.bar(...c.args);
        case "setcolor": return bgi.setcolor(...c.args);
        case "rectangle": return bgi.rectangle(...c.args);
        case "line": return bgi.line(...c.args);
        case "statusPanel": return drawStatusPanelBlock(panel, dg, c.args[0], c.args[1]);
        case "tankMove": return tankMove(c.args[0], 0xffbe);   // 경기장 배치(0x0865E)에서 부를 때의 BP
        case "markers": return withGlobalRand(() => updateMarkers(dv, c.args[0], { setColour: bgi.setcolor, moveTo: bgi.moveTo, lineTo: bgi.lineTo }));
      }
    },
    isRectangleClear: (a          ) => isRectangleClear(screen, a[0], a[1], a[2], a[3]),
    probe: (a          ) => probeS(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7]),
    readSeed: () => dv.getUint32(0x3268, true),
    writeSeed: (v        ) => dv.setUint32(0x3268, v >>> 0, true),
  };

  // ── 메뉴(0x054AD)와 결과 화면(0x090E9) — 옮긴 함수가 내보내는 호출을 그 자리에서 그린다 ────────
  const dgName = (at        ) => String.fromCharCode(...dgString(at));
  function fileHost(name        )                {
    const file = readRom(name); let pos = 0;
    return {
      open: () => (file ? 1 : 0), seek: (_, o) => { pos = o; }, getc: () => (file && pos < file.length ? file[pos++] : -1),
      close: () => {}, plot: (plane, off, c) => { vram[(plane & 3) * 0x10000 + (off & 0xffff)] = c; },
    };
  }
  const getch = ()         => (env.getch ? env.getch() : need("getch (이름 입력)"));
  const drawMenuCall = (c          )       => {
    switch (c.fn) {
      case "enterModeX": enterX(c.a); break;
      case "loadPalette": { const r = loadPaletteFromFile(readRom(dgName(c.name))); if (r.dac) dac.set(r.dac); break; }
      case "outport": modeX.outw(c.port, c.value); break;
      case "drawImage": imageDrawRle320x400(fileHost(dgName(c.name)), dg, c.page); break;
      case "panel": {
        // 0x1338 에서 스택 버퍼로 복사한 26바이트가 {bufRel} 이다 (menu_screen.ts 머리 주석)
        const [x, y, s, lo, hi, flag, col] = c.args;
        labelledPanel(vram, x          , y          , dgString(typeof s === "object" ? 0x1338 + s.bufRel : s), lo          , hi          , flag          , col          );
        break;
      }
      case "rectOutline": { const [x0, y0, x1, y1, col] = c.args; rectOutline(vram, x0, y0, x1, y1, col); break; }
      case "missionScreen": {
        // 0x05C3E 는 0x1352 의 표를 스택 버퍼로 복사해 그 안의 문자열을 그린다
        const m = drawMissionScreen(dg, c.row6, c.row8);
        for (const i of m.image) imageRedrawWindow320x400(fileHost(dgName(i.name)), dg, i.vtopLo, i.vtopHi, i.limitLo, i.limitHi, i.mirror);
        for (const t of [...m.shadow, ...m.main].sort((a, b) => a.si - b.si || a.colour - b.colour))
          vramString(vram, t.x, t.y, dgString(0x1352 + t.sOff), t.colour);
        break;
      }
      case "delay": env.delay?.(c.ms); break;
      case "quit1": throw new Quit("메뉴에서 끝내기 (exit(1))");
      // strcpy 는 runMainMenu 가 dg 에 이미 했다. cnfWrite 는 rom/ 을 덮지 않으려고 건너뛴다.
      // nameInput 은 아래 nameInput 함수가 그린다.
    }
  };
  // BIOS 키 버퍼 비우기 — 원본의 `while (kbhit()) getch()`. 옮긴 메뉴·상점·이름 입력은 입력 배관이라 이것을 빼 두었으므로
  // 원본이 비우는 자리에서 여기서 비운다: 메뉴 0x0571E(포트 읽기 뒤), 상점 0x06C76(포트 읽기 뒤), 이름 입력 0x052BE 머리.
  const flushBios = () => { if (env.kbhit && env.getch) while (env.kbhit()) env.getch(); };
  const nameInput = ([x, y, dst, col]          )         => {
    flushBios();
    const keys = new Proxy({}, { get: (_, p) => (p === "length" ? Infinity : getch()) })                     ;
    const r = textInputPrompt(vram, x, y, keys, col);
    if (r.result) { dg.set(r.out, dst); dg[dst + r.out.length] = 0; }
    return r.result;
  };
  const drawResultCall = (c       )       => {
    const text = (x        , y        , t        , col        ) => drawString(i16(x), i16(y), [...t].map((ch) => ch.charCodeAt(0)), col & 0xff, put);
    switch (c.fn) {
      case "setfillstyle": bgi.setfillstyle(c.pattern, c.colour); break;
      case "setcolor": bgi.setcolor(c.colour); break;
      case "bar": bgi.bar(c.x1, c.y1, c.x2, c.y2); break;
      case "rectangle": bgi.rectangle(c.x1, c.y1, c.x2, c.y2); break;
      case "line": bgi.line(c.x1, c.y1, c.x2, c.y2); break;
      case "drawString": text(c.x, c.y, c.str, c.colour); break;
      case "resultCell":
        for (const e of resultScreenTextCell(c.a, c.b, c.c, dg[0x4d79]).effects) if (e.kind === "drawString") text(e.x, e.y, e.text, e.colour);
        break;
      case "palette": dac.set([c.r, c.g, c.b], (c.index & 0xff) * 3); break;
      case "delay": env.delay?.(c.ms); break;
    }
  };
  // 상점 0x05FB3 — 메뉴처럼 호출을 그 자리에서 그린다. 문자열 인자는 DGROUP 근거리 포인터이거나 상점 프레임 안 버퍼다.
  // main 이 인자 없이 push cs; call 로 부르므로 BP 는 게임 루프와 같은 0xFFEE, 지역은 그 아래 0x23C 바이트.
  const SHOP_FRAME = 0xffee - 0x23c;
  const shopStr = (s                             ) => dgString(typeof s === "object" ? SHOP_FRAME + s.bufRel : s);
  const putStr = (at        , t        ) => { for (let i = 0; i <= t.length; i++) dg[(at + i) & 0xffff] = i < t.length ? t.charCodeAt(i) : 0; };
  const drawShopCall = (c          )       => {
    switch (c.fn) {
      case "enterModeX": enterX(c.a); break;
      case "outport": modeX.outw(c.port, c.value); break;
      case "loadPalette": { const r = loadPaletteFromFile(readRom(dgName(c.name))); if (r.dac) dac.set(r.dac); break; }
      case "drawImage": imageDrawRle320x400(fileHost(dgName(c.name)), dg, c.page); break;
      // 0x0488F 의 인자: [bp+8] 아래끝 = a, [bp+0xC] 위끝 = b, [bp+0x10] 뒤집기 (mode_x_image.ts). 원본이 민 순서 그대로다.
      case "image": imageRedrawWindow320x400(fileHost(dgName(c.name)), dg, c.bLo, c.bHi, c.aLo, c.aHi, c.extra); break;
      case "panel": labelledPanel(vram, c.x, c.y, shopStr(c.str), c.lo, c.hi, c.flag, c.colour); break;
      case "drawString": vramString(vram, c.x, c.y, shopStr(c.str), c.colour); break;
      case "rectFill": rectOutline(vram, c.a, c.b, c.c, c.d, c.e); break;
      case "itoa": putStr(SHOP_FRAME + c.dst.bufRel, String(i16(c.value))); break;      // 0x031E5, 부호 있는 16비트 십진
      case "ltoa": putStr(SHOP_FRAME + c.dst.bufRel, String(c.value | 0)); break;      // 0x03227, 부호 있는 32비트 십진
      case "delay": env.delay?.(c.ms); break;
      case "tankFileWrite": gap("탱크 파일 저장 (0x07792)"); break;
      case "tankFileRead": need("탱크 파일 불러오기 (0x07875)");
      // blockCopy 는 runShopScreen 이 dg 에 이미 했다
    }
  };

  // 게임 루프(BP 0xFFEE, sub sp 6)가 0x0ADDC 에서 인자 없이 push cs; call 로 부른다. 오토파일럿(잰 BP 0xFFE2)과 같은
  // 깊이라 BP = 0xFFE2, 지역은 그 아래 0x2B4 바이트
  const RESULT_FRAME = 0xffe2 - 0x2b4;

  // ── 게임 루프 ──────────────────────────────────────────────────────────────
  const stats = { iterations: 0, rounds: 0 };
  const maxIter = env.maxIter ?? Infinity;
  const gameLoopHost               = {
    graphicsInit: (a) => applyGfx(graphicsInitOrMode(a, dg[0x4d79])),
    roundPalette: () => { dac.set(roundPalette(dv)); },
    roundSetup: () => {
      stats.rounds++;
      const setup = () => runRoundSetup({
        changeWeapon: (t) => changeWeapon(weaponHost, dg, t),
        // 라운드 설정에서 부를 때의 BP
        arenaLayout: () => runArenaLayout(dg, { seed: 0, rectClearReturns: [], probeReturns: [], live: arenaLive, frameBp: 0xffbe }),
      }, dg, 0);
      if (!ls) return setup();
      // 락스텝: 진입 씨앗 후보로 라운드 설정을 돌려 보고, 끝난 씨앗이 골든 첫 프레임과 다르면 되돌려 다음 후보로
      const dg0 = dg.slice(), px0 = raster.px.slice();
      ls.roundStart(dg);
      for (let tries = 1; ; tries++) {
        setup();
        if (ls.startSeedOk(dg) || ls.recordedSeeds || tries >= 50) return;   // 원본에서 읽은 씨앗이면 다시 안 고른다
        dg.set(dg0); raster.px.set(px0);
        ls.retryRound(dg);
      }
    },
    kbhit: () => { ls?.iterationTop(dg); env.onIterationTop?.(); return env.kbhit?.() ?? 0; },
    getch: () => { env.getch?.(); },
    sampleKeyboard: () => {
      if (++stats.iterations > maxIter) throw new Stop(`게임 루프 반복 상한 ${maxIter}`);
      keySample();
    },
    dispatchInput: () => scancodeToPlayerInput({ weapon: weaponHost, beep: (hz) => { sound(hz); nosound(); } }, dg),
    autopilot: () => (ls?.afterDispatch(), runAutopilot({ ...fireHost, sampleKeyboard: keySample }, dg, arr)),
    tankMove: (a) => tankMove(a, 0xffe0),   // 게임 루프 0x0AC6C 에서 부를 때의 BP
    updateObjects: () => updateObjects(objectHost, dg, arr, 0xffe2),
    respawn: () => withGlobalRand(() => tankColourFlashAndRespawn({
      eraseTank: drawTankLive,
      probe: (x1, y1, x2, y2, n, c1, c2, c3) => probeS(x1, y1, x2, y2, n, c1, c2, c3),
      setDacRegister: (r, dh, ch, cl) => { dac.set([dh, ch, cl], (r & 0xff) * 3); },
      // 0x136C6 빈 반복 — 명령 수를 cycles 5000(1ms 에 5,000명령, 측정 계약)으로 시간으로 바꾼다
      sound, nosound, wait: (t) => env.delay?.(calibratedBusyWait(t, dv.getInt16(0x4d6f, true)).instructions / 5000),
    }, dg)),
    markers: (a) => withGlobalRand(() => updateMarkers(dv, a, { setColour: bgi.setcolor, moveTo: bgi.moveTo, lineTo: bgi.lineTo })),
    spin: (n) => { env.spin?.(n); },
    // 게임 루프가 0x0ACFE·0x0AD0E 에서 인자 둘로 부른다: BP = 0xFFEE - 6 - 4 - 4 - 2 = 0xFFDE
    statusPanel: (m, p) => drawStatusPanelBlock(panel, dg, m, p, 0xffde),
    escAward: () => escQuitAward(dg),
    resultScreen: () => {
      const r = runResultScreen(dg, { seed: dv.getUint32(0x3268, true), bufBase: RESULT_FRAME, readPort: () => env.port("result"), emit: drawResultCall });
      dv.setUint32(0x3268, r.endSeed, true);
      return r.ret;
    },
    fire: (s) => runFire(fireHost, dg, arr, s),
  };

  // 락스텝: 게임 루프가 부르는 것마다 난수를 몇 번 뽑았는지 센다
  if (ls) {
    const steps = (a        , b        ) => { let s = a >>> 0, k = 0; while (s !== b >>> 0 && k < 100_000) { s = randStep(s).next; k++; } return k; };
    for (const name of ["dispatchInput", "autopilot", "tankMove", "updateObjects", "respawn", "markers", "statusPanel", "fire"]         ) {
      const f = gameLoopHost[name]                        ;
      (gameLoopHost       )[name] = (...a       ) => { const s0 = dv.getUint32(0x3268, true); const r = f(...a); ls.noteDraws(name, steps(s0, dv.getUint32(0x3268, true))); return r; };
    }
  }

  // ── main ──────────────────────────────────────────────────────────────────
  // 속도 측정의 원시값은 하드웨어 타이밍이라 옮기지 않았다. 실측한 0x4D6F = 1131 을 내는 값을 찾아 넣는다
  // (cycles 5000). 락스텝에서는 골든의 값을 낸다.
  const SPEED = env.speed ?? (ls ? ls.speed() : 1131);
  function rawForSpeed()         {
    const key = readRom("DZONE.KEY") ;
    const mul = calibrationMultiplier(key[59], key[62], key[61 + 2]);
    for (let raw = 0; raw < 0x8000; raw++) if (calibrationScale(raw, mul).d4D6F === SPEED) return raw;
    return need("속도 측정 원시값");
  }

  let menus = 0;
  const mainHost           = {
    startupCalibration: () => {
      const r = startupSeedAndSpeedCalibration({ clockSeed: env.clockSeed ?? 0, rawDrawCount: rawForSpeed(), cnfFile: env.cnf ?? readRom("DZONE.CNF"), keyFile: readRom("DZONE.KEY") });
      if (r.cnf.r_4CC0) dg.set(r.cnf.r_4CC0, 0x4cc0);
      if (r.cnf.r_43FC) dg.set(r.cnf.r_43FC, 0x43fc);
      dg[0x4d73] = r.cnf.b_4D73; dg[0x4d68] = r.cnf.b_4D68; dg[0x4d65] = r.cnf.b_4D65;
      if (r.key.openFail) need("DZONE.KEY");
      else {
        const k = r.key;
        dg.set(k.r_4D3E, 0x4d3e); dg.set(k.r_4D7A, 0x4d7a);
        Object.entries({ 0x4d78: k.b_4D78, 0x4d74: k.b_4D74, 0x4d77: k.b_4D77, 0x4d79: k.b_4D79, 0x4d6a: k.b_4D6A,
          0x4d69: k.b_4D69, 0x4d6c: k.b_4D6C, 0x4d6b: k.b_4D6B, 0x4d8e: k.b_4D8E }).forEach(([a, v]) => { dg[Number(a)] = v; });
      }
      applyGfx(r.gfx);
      wr16(0x4d6f, r.d4D6F); wr16(0x4d6d, r.d4D6D); dg[0x1337] = r.d1337;
      applyStartup(r.greeting.effects);
      seedToDg();
    },
    startupGreeting: () => { randState.seed = dv.getUint32(0x3268, true); applyStartup(startupGreetingOrShareware(dg[0x4d8e]).effects); seedToDg(); },
    graphicsInit: (a) => applyGfx(graphicsInitOrMode(a, dg[0x4d79])),
    modeXEnter: (a) => enterX(a),
    imageLoad: (nameAt) => {
      const name = dgName(nameAt);
      const r = imageLoadToSecondPage(fileHost(name));
      if (r.palette) dac.set(r.palette.subarray(0, 768));
      if (r.ret !== 0) gap(`(원본도 같음) 그림 파일 ${name} 이 rom/ 에 없다`);
    },
    mainMenu: () => {
      env.onMenu?.(++menus);
      runMainMenu(dg, { keys: [], readPort: () => { const v = env.port("menu"); flushBios(); return v; }, nameInput, emit: drawMenuCall });
    },
    matchSetup: () => matchSetup(dv),
    // 0x05FB3 — 로봇만 있으면 키 루프에 안 들어간다. 사람이 있고 포트 읽기가 없으면 스캔코드가 모자라 멈춘다.
    shop: () => {
      ls?.shopStart(dg);
      const r = runShopScreen(dg, { seed: dv.getUint32(0x3268, true), scancodes: [], readPort: env.shopReadsPort ? () => { const v = env.port("shop"); flushBios(); return v; } : undefined,
        bufBase: SHOP_FRAME, emit: drawShopCall });
      dv.setUint32(0x3268, r.endSeed, true);
      return r.ret;
    },
    gameLoop: () => runGameLoop(gameLoopHost, dg),
  };

  return {
    dg, raster, vram, dac, vgaRegs, display, gaps, stats,
    /** main 을 돈다. 돌아오지 않고, 끝내는 것은 env 가 던지는 Stop 이다. */
    run: () => runMain(mainHost, dg),
  };
}
