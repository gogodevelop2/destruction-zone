// 원본 DZONE.EXE 의 메인 메뉴(0x054AD)가 부르는 화면 함수 둘 재구현.
//
//   0x05C3E  drawMissionScreen   미션 1..8 의 설명 화면을 그린다
//   0x13EED  quitWithStatus1     텍스트 모드로 되돌리고 exit(1) 로 끝낸다
//
// 바이트 근거는 disasm/addr_0x05C3E.md, disasm/addr_0x13EED.md. 정답표는
// goldens/menu_screen_vectors_v1 이고 port/test/menu_screen.test.ts 가 그것으로 판정한다.
// 앞으로 0x05D44·0x054AD 도 이 파일로 온다.
//
// ── 판정 경계 (CLAUDE.md 1단계) ──────────────────────────────────────────
// 두 함수 다 화면·프로그램을 만진다. 판정하는 것은 "화면에 무엇이 나왔나" 가 아니라
// 이미 옮긴 함수들(0x0488F imageRedrawWindow320x400, 0x051A8 vram drawString,
// 0x04206 restoreTextMode, exit)에 **무슨 인자를 넘겼나** 다. 그래서 drawMissionScreen
// 은 그림을 그리지 않고 넘길 인자의 목록을 돌려준다.
//
// ── 미션 설명 표 (DGROUP 0x1352, 0x9AB 바이트) ──────────────────────────
// disasm 의 uncertain 이 "이 덩어리가 무엇인지 모른다" 였다. EXE 에서 떠 보면 구조가
// 있다. 2475 = 9줄 × 275. 한 줄은 [int16 줄수][39바이트 NUL 끝 문자열 7개] 다
// (2 + 7*39 = 275). 0번 줄은 줄수 0 이라 비어 있고, 1..8번이 미션 1..8 의 설명이다
// ("mission 1 - hostile mode", "you must play at least 90 rounds in", …). 줄수가
// 4/6/6/6/5/5/4/5 다. 이 표를 읽는 함수는 0x05C3E 하나뿐이라(disasm·analysis 전체
// grep) 형식을 여기 둔다.
//
// ── 표 밖 줄 색인은 게임에서 도달하지 않는다 ─────────────────────────────
// [bp+6]·[bp+8] 은 경계 검사 없는 워드 색인이고 `imul 0x113` 이 부호 있는 곱셈이라,
// 색인이 0..8 밖이면 원본은 스택 버퍼(2476바이트) 밖 — 저장된 bp·복귀 주소 등 —
// 을 줄수로 읽는다. 그런데 게임의 두 부르는 곳(0x05899·0x058BD)이 넘기는 값은
// 0x054AD 의 지역 변수 [bp-8] 하나에서 나오고, 그 변수는 세 자리에서만 바뀐다:
// 0x054C7 에서 0, 0x058A7 에서 inc, 0x058B0 에서 (== 9 이면) 0. 즉 0..8 만 유지된다.
// 그래서 아래 rowOffset 의 throw 는 게임 경로에서는 도달하지 않는다 (port/lib/text.ts
// drawGlyph 와 같은 처리 — 원본이 밖에서 무엇을 읽는지 적고 크게 실패한다).
// hold-out(hold-row-9, hold-row-negative)이 그 밖 경로에서 원본이 무엇을 하는지
// 기록으로 남겼다 — 그 값은 하니스가 부른 자리에 매인 것이지 함수가 정한 것이 아니다
// (정답표 blindSpots).
//
// ── 0x054AD (main-menu) 도 이 파일에 있다 ────────────────────────────────
// 아래 runMainMenu 를 보라. 그 함수 바로 위 주석이 판정 경계와 DGROUP 0x1240 의 뜻을
// 접어 둔다.
//
// @원본 0x05C3E 0x13EED 0x054AD

import { restoreTextMode } from "./mode_x.js";

const u16 = (v        )         => v & 0xffff;
const i16 = (v        )         => (v << 16) >> 16;
const sbyte = (v        )         => (v << 24) >> 24;

const BLOB_OFF = 0x1352;
const BLOB_LEN = 0x9ab;          // 원본 `mov cx, 0x9ab` — 2475 = 9 × 275
const BUF_LEN = 0x9ac;           // 원본 `sub sp, 0x9ac` — 한 바이트 더 잡는다 (안 쓴다)
const ROW_LEN = 275;             // 0x113
const STR_LEN = 39;              // 0x27
const NAME_PTR = 0x2244;         // 0x05C91 `mov ax, 0x2244` — DGROUP "dzone.gda" 사본

/** 0x0488F(imageRedrawWindow320x400)에 넘기는 인자 한 벌. 스택 자리 순서다: name [bp+6], limit [bp+8] (아래끝),
 *  vtop [bp+0xC] (위끝 = 시작 줄), mirror [bp+0x10] — mode_x_image.ts 의 인자 뜻과 같다. */
                         
             
               
                                   
                                 
                 
  

/** 0x051A8(vram drawString)에 넘기는 인자 한 벌. sOff 는 복사된 버퍼 안 오프셋. */
                          
             
                       
               
                 
  

                                  
                     
                                                     
                       
                                           
                     
  

function rowOffset(arg        , who        )         {
  const idx = i16(arg);
  if (idx < 0 || idx > 8) {
    throw new RangeError(
      `${who}: 줄 색인 ${idx} 이 미션 표(0..8) 밖이다. 원본은 &buf + ${idx}*275 로 ` +
      `스택 버퍼(2476바이트) 밖 — 저장된 bp·복귀 주소 — 을 줄수로 읽는다. 게임의 두 ` +
      `부르는 곳(0x05899·0x058BD)은 [bp-8] 을 0..8 로만 유지하므로 이 자리는 게임에서 ` +
      `도달하지 않는다 (port/lib/menu_screen.ts 머리 주석).`,
    );
  }
  return idx * ROW_LEN;
}

function count16(buf            , at        )         {
  return buf[at] | (buf[at + 1] << 8);
}

/**
 * 원본 0x05C3E 를 옮긴 것. DGROUP 을 받아 미션 설명 화면의 그리기 인자 목록을 만든다.
 *
 * 원본은 DGROUP 0x1352 의 2475바이트를 스택 버퍼에 복사한 뒤 si = 0..6 을 돌며:
 *  - `int16([행A].줄수) > si` 면 이미지 다시 그리기 한 번 (행A = 버퍼 + [bp+8]*275).
 *  - `int16([행B].줄수) > si` 면 문자열을 두 번 그린다 (행B = 버퍼 + [bp+6]*275):
 *    그림자(colour 0)를 (0x2F, si*32+0x3B)에, 본체(colour dl)를 (0x30, si*32+0x3C)에.
 *    x·y 가 1 씩 차이 나는 것이 그림자 수법이다 (port/lib/text.ts drawString 과 같다).
 *  두 검사는 서로 다른 줄을 본다 — 이미지는 [bp+8], 문자열은 [bp+6].
 *
 * dl(본체 colour)은 원본 0x05CE3..0x05D04 를 그대로 옮긴다. 바이트 연산과 워드 연산이
 * 섞여 있어 줄이지 않는다: si==0 이면 3, 아니면 2.
 *
 * 그림자 colour 는 원본이 `mov al, 0 ; push ax` 로 넘긴다 — AL 만 0 이고 AH 는 직전
 * 계산(row6*275 + &buf)의 상위 바이트가 그대로 남은 값이다. &buf 가 스택 주소라 그
 * AH 는 함수가 정한 값이 아니다. 여기서는 colour 를 0 으로 둔다. 0x051A8(drawString)이
 * `mov al, byte ptr [bp+0xc]` 로 **하위 바이트만** 읽으므로 소비되는 값은 어차피 0 이다.
 * (정답표는 push 된 워드 그대로 담고, 시험은 하위 바이트만 대조한다.)
 *
 * @param dg    0x10000 바이트. 0x1352 부터 0x9AB 바이트를 복사한다.
 * @param row6  [bp+6]. 문자열을 가져올 줄 (0..8, 밖이면 throw).
 * @param row8  [bp+8]. 이미지 조건을 볼 줄 (0..8, 밖이면 throw).
 */
export function drawMissionScreen(dg            , row6        , row8        )                     {
  const buf = new Uint8Array(BUF_LEN);
  buf.set(dg.subarray(BLOB_OFF, BLOB_OFF + BLOB_LEN), 0);   // far-block-copy 0x01191

  // 두 줄 오프셋은 si 에 안 매이므로 한 번만 구한다 (원본은 반복마다 imul 한다).
  const rowAoff = rowOffset(row8, "drawMissionScreen(이미지 줄 [bp+8])");
  const rowBoff = rowOffset(row6, "drawMissionScreen(문자열 줄 [bp+6])");

  const image              = [];
  const shadow               = [];
  const main               = [];

  for (let si = 0; si < 7; si++) {                          // cmp si, 7 ; jge
    if (i16(count16(buf, rowAoff)) > si) {                  // cmp [행A], si ; jle → 건너뜀
      // 0x05C7F 에서 먼저 민 si*32+0x42 가 [bp+0xC] 위끝(시작 줄), 0x05C8B 의 si*32+0x3A 가 [bp+8] 아래끝이다.
      // 그 줄의 글자 자리(y = si*32+0x3B..)를 배경 그림으로 다시 그려 앞 미션 글을 지운다.
      const vtop = u16((si << 5) + 0x42);                   // shl ax,5 ; add ax,0x42
      const limit = u16((si << 5) + 0x3a);                  // shl ax,5 ; add ax,0x3a
      image.push({
        si, name: NAME_PTR,
        limitLo: limit, limitHi: i16(limit) < 0 ? 0xffff : 0,   // cdq (여기선 늘 0)
        vtopLo: vtop, vtopHi: i16(vtop) < 0 ? 0xffff : 0,
        mirror: 0,
      });
    }

    if (!(i16(count16(buf, rowBoff)) > si)) continue;       // cmp [행B], si ; jg ... ; jmp 다음 si

    const sOff = 2 + rowBoff + si * STR_LEN;                // lea [bp-0x9aa] (=buf+2) + [bp+6]*275 + si*39
    shadow.push({ si, x: 0x2f, y: u16((si << 5) + 0x3b), sOff, colour: 0 });

    // 본체 colour dl — 0x05CE3..0x05D04 직역. a: imul 3 (워드), b: shl al,1 (바이트),
    // dl: add dl,al (바이트).
    const a = (si === 0 ? 1 : 0) * 3;
    const b = ((si === 0 ? 0 : 1) << 1) & 0xff;
    const dl = (a + b) & 0xff;
    main.push({ si, x: 0x30, y: u16((si << 5) + 0x3c), sOff, colour: dl });
  }

  return { image, shadow, main };
}

// ── 0x13EED: 오류로 프로그램을 끝낸다 ──────────────────────────────────────
//
// 열 명령이 전부다. `push cs; call 0x4206`(restoreTextMode — 텍스트 모드로) 그다음
// `mov ax,1; push ax; lcall exit`. 0x13EFF 의 retf 는 도달할 수 없다 — exit 에서 안
// 돌아온다. 컴파일러가 냈을 뿐이다. 부르는 곳은 0x054AD 안 0x058C7 하나.
// 상태 1 은 정상 종료가 아니라 오류 종료다 (말뭉치의 다른 exit(1)은 dzone.key 를 못
// 읽은 0x13B00 의 갈래).

                           
                                                        
                          
                            
                           
 

/** 원본 0x13EED 를 옮긴 것. 텍스트 모드로 되돌리고 exit(1). */
export function quitWithStatus1(host          )       {
  restoreTextMode(host);   // 0x13EF1
  host.exit(1);            // 0x13EF8: mov ax,1 ; push ax ; lcall exit
}

// ── 0x054AD: 메인 메뉴 ────────────────────────────────────────────────────────
//
// DZONE.EXE 를 켜면 나오는 첫 화면. 위 3칸 + 3×3 격자 = 12칸을 화살표로 옮기고
// 스페이스나 엔터로 고른다. 칸 0 을 고르면 설정을 DZONE.CNF 에 쓰고(0x05B2A) 미션
// 화면(0x05C3E)을 부른 뒤 함수가 끝난다 — 유일한 정상 출구다. 칸 2 는 exit(1)(0x13EED).
// 나머지 칸은 값을 바꾸고 화면을 다시 그린 뒤 루프로 돌아간다.
//
// ── 판정 경계 (CLAUDE.md 1단계) ────────────────────────────────────────────
// 이 함수는 화면 함수 열 몇 개를 부르고 포트 0x60 에서 스캔코드를 직접 읽는다. 판정하는
// 것은 화면 픽셀이 아니라 (1) 밖으로 부른 것의 순서와 인자, (2) 끝난 뒤의 DGROUP 차이
// 둘이다. 그래서 runMainMenu 는 화면 함수를 실제로 부르지 않고 부를 인자의 목록
// (MenuCall[])을 돌려주며 상태 바이트만 dg 에 쓴다. 스캔코드는 script.keys 가 준다
// (원본 0x05710 의 `in al,0x60` 자리). drawMissionScreen 과 같은 처리다.
//
// [bp-0x24] 지역 버퍼(36바이트, DGROUP 0x1338 에서 26바이트만 복사)는 사본을 안 만든다.
// 그 버퍼를 읽는 자리는 0x05091 인자로 `&buf + [0x4D65]*13` 을 넘기는 두 곳(0x055F9·
// 0x0595F)뿐이고, 그 인자는 그리기 함수가 소비한다. 포트는 그 자리에 `{bufRel: [0x4D65]*13}`
// 를 기록한다 — 원본이 넘긴 스택 주소의 버퍼 안 오프셋과 같은 값이다.
//
// ── DGROUP 0x1240 (원래 disasm/data_0x1240.md 의 note 였다) ──────────────────
// 상점 카탈로그(0x5DC..0x123F)와 해상도 표(0x1241..) 사이의 한 바이트다. disasm 전체에서
// 이 바이트를 읽거나 쓰는 함수는 0x054AD 하나뿐이다. 뜻: 게임에서 메뉴로 돌아왔을 때
// 그래픽을 다시 세우지 않고 건너뛰게 하는 플래그다. 0 이면(새 프로세스의 BSS 초기값)
// enterModeX(3) 과 loadPalette 를 부르고, 0 이 아니면 그것을 건너뛰고 [0x4D6A]==0 일 때
// BIOS 키 버퍼를 비운다(원본은 이 자리에서 getch 로 막힐 수 있다 — 재현하지 않는다).
// 어느 쪽이든 마지막에 0 으로 지운다. 이 함수가 0 이 아닌 값을 쓰는 자리는 없다.
// (앞의 산술 근거 `0x5DC + 52*0x3D = 0x1240` 은 disasm/data_0x1240.md 에 그대로 남긴다.)

/** 소극적 그리기 인자 안에 들어가는 표식. `&buf + off` 로 넘어간 버퍼 상대 주소. */
                                        

/** runMainMenu 가 순서대로 쌓는 "밖으로 부른 것" 하나. */
                      
                                                                    
                                                                    
                                                                    
                                                                    
                                                                          
                                                                          
                                                                    
                                                                    
                                                                                   
                                                                    
                                                                    
                                                          // 0x13EED

                             
                                                    
                 
                                                      
                                                 
                                                      
                                                 
                          
                                                         
                               
 

                             
                    
                                                        
                         
 

const TANK0 = 0x43fc;
const TANK_STRIDE = 0x176;
const NAME0 = 0x4cc1;
const NAME_STRIDE = 0x15;
const NAME_TABLE = 0x128d;      // 종류별 이름 표, 0xd 간격

/**
 * 원본 0x054AD 를 옮긴 것. dg(0x10000 바이트 DGROUP)와 스캔코드 대본을 받아 밖으로 부른
 * 것의 순서 있는 목록을 돌려주고, 상태 바이트(0x1240·0x4D65·0x4D68·0x4D73·탱크 종류·
 * 이름 버퍼)를 dg 에 쓴다.
 */
export function runMainMenu(dg            , script            )             {
  const calls             = [];
  const out = (c          )       => { calls.push(c); script.emit?.(c); };
  const keys = [...script.keys];
  const nameFn = typeof script.nameInput === "function" ? script.nameInput : null;
  const nameRets = Array.isArray(script.nameInput) ? [...script.nameInput] : [];
  let keyPos = 0;

  const rd = (a        )         => dg[u16(a)];
  const wr = (a        , v        )       => { dg[u16(a)] = v & 0xff; };
  const rdsb = (a        )         => sbyte(dg[u16(a)]);
  const num = (n        )                   => [u16(n), u16(n < 0 ? -1 : 0)];   // cwde;cdq → lo,hi

  // 0x054C7 — 미션 색인. 0x058A1(칸 1)이 올리고 9 에서 0 으로 되돌린다.
  let missionIdx = 0;      // [bp-8]
  let missionPrev = 0;     // [bp-0xa]

  // ── 준비 (0x054D1..0x05505) ──────────────────────────────────────────────
  if (sbyte(rd(0x1240)) === 0) {
    out({ fn: "enterModeX", a: 3 });               // 0x054DD
    out({ fn: "loadPalette", name: 0x21cc });      // 0x054E6
  }
  out({ fn: "outport", port: 0x3d4, value: 0x800c });  // 0x054F2
  out({ fn: "drawImage", name: 0x21d6, page: 0 });     // 0x05501

  // 0x05506 — [0x1240]!=0 이면 재초기화를 건너뛴 것이고, [0x4D6A]==0 이면 키 버퍼를
  // do-while 로 비운다(getch 를 한 번은 무조건 — 빈 버퍼면 원본이 막힌다). 재현 안 함.
  if (rd(0x1240) !== 0) wr(0x1240, 0);                    // 0x05525 (je 0x552a 가 이 write 를 건너뛴다)

  // ── 한 번 그리기 (0x0552A..0x05669) ─────────────────────────────────────
  let cell = 0;           // [bp-2]  byte 0..11
  let cursorX = 0x10;     // di      word
  let cursorY = 0xb;      // [bp-4]  word
  let redraw = 1;         // [bp-5]  byte

  out({ fn: "panel", args: [0x11, 0x0c, 0x21e0, 0, 0, 0, 2] });  // 0x05557
  out({ fn: "panel", args: [0x75, 0x0c, 0x21ed, 0, 0, 0, 2] });  // 0x05574
  out({ fn: "panel", args: [0xd9, 0x0c, 0x21fb, 0, 0, 0, 2] });  // 0x05591
  out({ fn: "panel", args: [0x11, 0x138, 0x2206, ...num(rdsb(0x4d73)), 0, 2] });  // 0x055B1
  out({ fn: "panel", args: [0x11, 0x156, 0x220e, ...num(rdsb(0x4d68)), 0, 2] });  // 0x055D1
  out({ fn: "panel", args: [0x11, 0x174, { bufRel: rdsb(0x4d65) * 0xd }, 0, 0, 0, 2] });  // 0x055F9

  for (let s = 0; s < 6; s++) {                           // 0x05601..0x05650 (si 0..5)
    const q = Math.trunc(s / 3);
    out({ fn: "panel", args: [
      u16(q * 0x64 + 0x75),                               // (si/3)*0x64 + 0x75
      u16(s * 0x1e + 0x138 - q * 0x5a),                   // si*0x1e+0x138 - (si/3)*0x5a
      u16(s * NAME_STRIDE + NAME0),                       // si*0x15 + 0x4cc1
      0, 0, 0, 3,
    ] });
  }
  out({ fn: "outport", port: 0x3d4, value: 0x0c });  // 0x0565A
  out({ fn: "loadPalette", name: 0x2215 });          // 0x05666

  // ── 되풀이 (0x0566A 에서 시작, 0x05B0D 의 jmp 가 돌아온다) ────────────────
  for (;;) {
    if (redraw !== 0) {                                   // 0x0566A cmp [bp-5],0 ; jne
      // 0x05673 — 옛 커서 지우기.
      out({ fn: "rectOutline", args: [
        u16(cursorX), u16(cursorY), u16(cursorX + 0x56), u16(cursorY + 0x10), 0,
      ] });
      // 0x0568E — 칸에 따라 새 커서 자리.
      const c = sbyte(cell);
      if (c === 0 || c === 1 || c === 2) {                // 0x05692
        cursorX = u16(c * 0x64 + 0x10);
        cursorY = 0xb;
      } else {                                            // 0x056B7
        cursorX = u16((c % 3) * 0x64 + 0x10);
        cursorY = u16(Math.trunc((c - 3) / 3) * 0x1e + 0x137);
      }
      // 0x056E7 — 새 커서 그리기.
      out({ fn: "rectOutline", args: [
        u16(cursorX), u16(cursorY), u16(cursorX + 0x56), u16(cursorY + 0x10), 1,
      ] });
      redraw = 0;                                         // 0x05702
      out({ fn: "delay", ms: 0xb4 });              // 0x0570A
    }

    // 0x05710 — 스캔코드 하나 (원본 `in al,0x60`).
    if (!script.readPort && keyPos >= keys.length) {
      throw new Error("runMainMenu: script.keys 소진 — 칸 0 활성화 전에 스캔코드가 떨어졌다");
    }
    const scan = (script.readPort ? script.readPort() : keys[keyPos++]) & 0xff;
    // 0x0571E — while(kbhit()) getch()  : BIOS 버퍼를 안 쓰므로 재현하지 않는다.

    // ── 화살표 (0x05727..0x057B2) — 넷 다 독립된 if. ────────────────────────
    if (scan === 0x48 && i16(sbyte(cell) - 3) >= 0) {                  // UP
      cell = (sbyte(cell) - 3) & 0xff; redraw = 1;
    }
    if (scan === 0x50 && i16(sbyte(cell) + 3) < 0xc) {                 // DOWN
      cell = (sbyte(cell) + 3) & 0xff; redraw = 1;
    }
    if (scan === 0x4b && sbyte(cell) % 3 > 0 && i16(sbyte(cell) - 1) >= 0) {  // LEFT
      cell = (sbyte(cell) - 1) & 0xff; redraw = 1;
    }
    if (scan === 0x4d && sbyte(cell) % 3 < 2 && i16(sbyte(cell) + 1) < 0xc) { // RIGHT
      cell = (sbyte(cell) + 1) & 0xff; redraw = 1;
    }

    // ── 칸 6 = [0x4D68] 스핀 컨트롤 (0x057BB..0x05865) ─────────────────────
    if (sbyte(cell) === 6) {
      const before = rdsb(0x4d68);                        // 0x057BB
      if (scan === 0x39 || scan === 0x1c || scan === 0x0d || scan === 0x4e || scan === 0x49) {
        wr(0x4d68, rd(0x4d68) + 3);                       // 0x057DF
      }
      if (scan === 0x0c || scan === 0x4a || scan === 0x51) {
        wr(0x4d68, rd(0x4d68) + 0xfd);                    // 0x057F9 (-3)
      }
      if (rdsb(0x4d68) > 0x78) wr(0x4d68, 3);             // 0x05801 (부호 있는 비교)
      if (rdsb(0x4d68) < 3) wr(0x4d68, 0x78);             // 0x0580D
      if (rdsb(0x4d68) !== before) {                      // 0x05819 cmp ax,si ; jne
        out({ fn: "panel", args: [
          0x11, 0x156, 0x221f, ...num(rdsb(0x4d68)), 1, 2,
        ] });                                             // 0x0583B
        const fast = scan === 0x49 || scan === 0x51 ? 1 : 0;
        out({ fn: "delay", ms: u16(0xc8 - fast * 0x64) });  // 0x05854..0x0585F
        continue;                                         // 0x05865 jmp 0x5B0D → 0x566A
      }
      // before === after → 0x05868 로 떨어진다 (아래 스페이스/엔터 검사).
    }

    // ── 스페이스/엔터 → 갈래 (0x05868..) ──────────────────────────────────
    if (scan !== 0x39 && scan !== 0x1c) continue;         // 0x05874 jmp 0x5B0D → 0x566A
    const c = sbyte(cell);
    if (u16(c) > 9) {                                     // 0x0587D cmp bx,9 ; jbe (부호 없음)
      defaultPath(c);
      continue;
    }
    switch (c) {
      case 0: {                                           // 0x0588C
        out({ fn: "cnfWrite" });                   // 0x0588E
        out({ fn: "missionScreen", row6: 0, row8: u16(missionIdx) });  // 0x05899
        return { calls, end: "return" };                  // 0x0589E jmp 0x5B10 → retf
      }
      case 1: {                                           // 0x058A1
        missionPrev = u16(missionIdx);
        missionIdx = u16(missionIdx + 1);
        if (missionIdx === 9) missionIdx = 0;
        out({ fn: "missionScreen", row6: u16(missionIdx), row8: u16(missionPrev) });  // 0x058BD
        out({ fn: "delay", ms: 0xb4 });            // 0x05B03
        continue;
      }
      case 2: {                                           // 0x058C5
        out({ fn: "quit1" });                      // 0x058C7 → exit(1)
        return { calls, end: "quit" };
      }
      case 3: {                                           // 0x058CA
        wr(0x4d73, rdsb(0x4d65) + rdsb(0x4d73) + 1);      // al=[0x4D65]; add al,[0x4D73]; inc al
        if (rdsb(0x4d73) >= 7) wr(0x4d73, 2);             // 0x058D6 cmp 7 ; jl → else 2
        out({ fn: "panel", args: [
          0x11, 0x138, 0x2220, ...num(rdsb(0x4d73)), 1, 2,
        ] });                                             // 0x058E2 (jmp 0x5959)
        out({ fn: "delay", ms: 0xb4 });            // 0x05B03
        continue;
      }
      case 9: {                                           // 0x058F8
        wr(0x4d65, rdsb(0x4d65) === 0 ? 1 : 0);           // neg;sbb;inc = 논리 부정
        if (rdsb(0x4d65) !== 0 && rdsb(0x4d73) % 2 !== 0) {  // 0x05904 / 0x0590B idiv 2 ; or dx,dx
          wr(0x4d73, rd(0x4d73) + 1);                     // 0x05919
          out({ fn: "panel", args: [
            0x11, 0x138, 0x2221, ...num(rdsb(0x4d73)), 1, 2,
          ] });                                           // 0x05937
        }
        out({ fn: "panel", args: [
          0x11, 0x174, { bufRel: rdsb(0x4d65) * 0xd }, 0, 0, 0, 2,
        ] });                                             // 0x0595F
        out({ fn: "delay", ms: 0xb4 });            // 0x05B03
        continue;
      }
      default: {                                          // 칸 4·5·6·7·8 → 0x05968 (표 기본)
        defaultPath(c);
        continue;
      }
    }
  }

  // ── 기본 경로 (0x05968..0x05B00) ───────────────────────────────────────────
  // 격자 칸 하나가 가리키는 탱크의 종류 바이트를 올린다. 넘치면 종류=색인/3, 0 이 되면
  // 이름을 받고(0x052BE), 아니면 0x128D 표에서 이름을 strcpy 한다.
  function defaultPath(cc        )       {
    // [bp-6] = (cc%3 - 1)*3 + (cc-4)/3   (바이트 덧셈)
    const tankIdx = ((cc % 3 - 1) * 3 + Math.trunc(i16(cc - 4) / 3)) & 0xff;
    const tankAt = u16(TANK0 + sbyte(tankIdx) * TANK_STRIDE);
    const q = Math.trunc(sbyte(tankIdx) / 3);
    const dst = u16(NAME0 + sbyte(tankIdx) * NAME_STRIDE);

    wr(tankAt, rd(tankAt) + 1);                           // 0x05999 inc
    if (rdsb(tankAt) > 5) wr(tankAt, Math.trunc(sbyte(tankIdx) / 3));  // 0x059A8 (부호 있는 비교)

    const drawName = ()       => {
      out({ fn: "panel", args: [
        u16(q * 0x64 + 0x75),
        u16(sbyte(tankIdx) * 0x1e + 0x138 - q * 0x5a),
        u16(NAME0 + sbyte(tankIdx) * NAME_STRIDE),
        0, 0, 0, 3,
      ] });
    };

    if (rdsb(tankAt) !== 0) {                             // 0x059D5 cmp 0 ; jne 0x059DF
      out({ fn: "strcpy", dst, src: u16(NAME_TABLE + rdsb(tankAt) * 0xd) });  // 0x05A05
      strcpyInto(dg, dst, u16(NAME_TABLE + rdsb(tankAt) * 0xd));
      drawName();                                         // 0x05A0C
    } else {                                              // 0x05A60
      if (!nameFn && nameRets.length === 0) {
        throw new Error("runMainMenu: script.nameInput 소진 — 이름 입력 갈래가 대본보다 많이 났다");
      }
      const args = [u16(cursorX + 5), u16(cursorY + 5), dst, 3];
      out({ fn: "nameInput", args });                     // 0x05A7E (덮음)
      const ret = (nameFn ? nameFn(args) : nameRets.shift() ) & 0xff;
      if (ret === 0) {                                    // 0x05A84 or al,al ; je 0x05A8A
        wr(tankAt, 1);                                    // 0x05A95
        out({ fn: "strcpy", dst, src: 0x129a });   // 0x05AAB
        strcpyInto(dg, dst, 0x129a);
      }
      drawName();                                         // 0x05AB2
    }
    out({ fn: "delay", ms: 0xb4 });                // 0x05B03
  }
}

/** strcpy(dst, src) — src 에서 NUL 까지(포함) dg 안에서 복사. 원본 0x03972 의 효과. */
function strcpyInto(dg            , dst        , src        )       {
  let d = u16(dst), s = u16(src);
  for (;;) {
    const b = dg[s];
    dg[d] = b;
    d = u16(d + 1); s = u16(s + 1);
    if (b === 0) return;
  }
}
