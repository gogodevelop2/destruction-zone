// 원본 0x05D44 (shop-tank-panel) 재구현.
//
// 상점 화면 0x05FB3 이 탱크 칸 하나를 그릴 때 0x066B2 에서 한 번 부른다. 이 함수는
// 화면을 안 만진다 — 카탈로그 52개를 훑어 "이 탱크가 지금 이 칸에서 살 수 있는 품목"
// 만 골라 [bp+6] 이 가리키는 DGROUP 자리에 품목 번호를 늘어놓고, 그 개수를 돌려준다.
//
// 바이트 근거는 disasm/addr_0x05D44.md. 정답표는 goldens/shop_panel_vectors_v1 이고
// port/test/shop.test.ts 가 그것으로 판정한다.
//
// ── 판정 경계 (CLAUDE.md 1단계) ──────────────────────────────────────────
// 이 함수는 DGROUP 만 읽고 쓴다. 판정하는 것은 (1) 돌려준 개수, (2) [bp+6] 자리에 쓴
// 바이트열 둘이다. 화면은 애초에 안 만진다.
//
// ── 필터 (카탈로그 레코드 = DGROUP 0x5DC + item*0x3D) ─────────────────────
// 바깥은 분류 cat = 0..9, 안은 품목 item = 1..0x33. 품목이 목록에 들어가려면:
//  · item 이 4·5 면 크레딧이 5000 을 넘지 않아야 한다 (0x05D78..0x05DA0).
//  · 비용 != 0 (0x05E00).
//  · 크레딧 >= 비용 (0x05E76..0x05E93, 상위 워드는 부호 있게 하위는 부호 없이).
//  · 카탈로그[item].+0x32 (장착 위치) == cat (0x05E95..0x05EA7).
//  · cat 이 9 면 이 탱크의 장비 배열 [+0x35 + 카탈로그[item].+0x38] 이 1 이 아니어야
//    한다 (0x05EA9..0x05ED3 — 이미 산 소극적 업그레이드는 뺀다).
//
// 비용식 (0x05DA3..0x05DF7, Borland 32비트 곱셈 lmul·부호 있는 나눗셈 sdiv):
//   비용 = sdiv( lmul(pct+100, sdiv(lmul(배수, 가격), 4)), 200 )
// 배수는 이 탱크 [+0x35] 가 0 이 아니면 3, 0 이면 4 (0x05D55). 가격은 카탈로그[item]
// 의 +0x39 32비트. pct 는 0x05F07(scorePercentFromDgroup)이 낸 이 탱크의 평균 대비
// 점수 퍼센트. LSDIV@ 진입점이 인자 8바이트를 스스로 걷으므로, 먼저 밀어 둔 200 이
// 두 번째 나눗셈까지 스택에 살아 있다.
//
// 비용이 0 이면 그 품목을 뺀다. 비용의 상위 워드에 부호 비트가 서 있으면(음수) 카탈로그
// 레코드 (탱크.+0x01 + 5) — 이 탱크 차체의 레코드 — 의 가격으로 비용을 한 번 다시
// 계산하고(0x05E13), 다시 계산한 값은 0·음수 재검사 없이 곧바로 크레딧 검사로 간다.
// 원본 0x05E0D 의 `cmp [bp-8],0 ; jae` 는 부호 없는 비교라 언제나 참이다 — 그 아래로
// (상위==0, 하위!=0 인데 다시 계산으로) 떨어지는 길은 컴파일러가 낸 것이고 도달할 수
// 없다 (0x13EED 의 못 닿는 retf 와 같은 종류).
//
// ── 표를 자르지 않는다 ──────────────────────────────────────────────────
// 색인은 전부 경계 검사 없이 `cbw ; imul <stride>` 다. [bp+8]·[bp+6]·item·cat·탱크.+0x01
// 이 음수면 원본은 세그먼트를 감아서 읽는다. 포트도 64KiB 를 통째로 들고 16비트로 접힌
// 오프셋으로 색인한다. hold-out(hold-slot-negative)이 그 자리를 판정한다.
//
// ── 0x05FB3 (shop-screen) 도 이 파일에 있다 ──────────────────────────────
// 아래 runShopScreen 을 보라. 그 함수 바로 위 주석이 판정 경계·프레임 모델·1~3단계
// 구조를 접어 둔다. 0x066B2 에서 위의 drawShopTankPanel(0x05D44)을 부른다.
//
// @원본 0x05D44 0x05FB3

import { sdiv, lmul, lshl, u32 } from "./borland_long.js";
import { scorePercentFromDgroup } from "./score.js";
import { randStep } from "./rand.js";

const u16 = (v        )         => v & 0xffff;
const i16 = (v        )         => (v << 16) >> 16;
const sbyte = (v        )         => (v << 24) >> 24;

const TANK_BASE = 0x43fc, TANK_STRIDE = 0x176;
const T_CHASSIS = 0x01;          // 바이트, 차체 종류. [bx+0x43fd]
const T_CREDIT_LO = 0x30;        // 32비트 크레딧 하위 워드. [bx+0x442c]
const T_CREDIT_HI = 0x32;        //           상위 워드. [bx+0x442e]
const T_EQUIP = 0x35;            // 장비 배열 (match_setup 이 12바이트 0 으로). [bx+0x4431]

const CAT_STRIDE = 0x3d;
const C_PORT = 0x60e;            // 카탈로그 +0x32 (장착 위치). [bx+0x60e]
const C_ACTION = 0x614;          // 카탈로그 +0x38 (동작 식별자). [bx+0x614]
const C_PRICE_LO = 0x615;        // 카탈로그 +0x39 32비트 하위 워드. [bx+0x615]
const C_PRICE_HI = 0x617;        //                    상위 워드. [bx+0x617]
// 다시 계산이 읽는 자리. 0x746 = 0x615 + 5*0x3D 이므로 0x746 + t01*0x3D 는 카탈로그
// 레코드 (t01+5) 의 가격 하위 오프셋이다 (차체 레코드는 5..9). 기저 확정은 이 작업 밖.
const CHASSIS_PRICE_LO = 0x746, CHASSIS_PRICE_HI = 0x748;

function u16at(dg            , at        )         {
  return dg[u16(at)] | (dg[u16(at + 1)] << 8);
}

/** 비용식 한 번. 0x05DA3..0x05DF7 (다시 계산 0x05E13..0x05E73 도 같은 모양). */
function costOf(dg            , price        , multiplier        , ti        )         {
  const p1 = lmul(u32(multiplier), price);                    // 0x05DC9 lmul(배수, 가격)
  const q1 = sdiv(p1, 4);                                     // 0x05DD0 sdiv(·, 4)
  const pct = u16(scorePercentFromDgroup(dg, ti) + 0x64);     // 0x05DDE call ; 0x05DE2 add ax,0x64 (16비트)
  const pctExt = u32(i16(pct));                               // 0x05DE5 cwd
  const p2 = lmul(pctExt, q1);                                // 0x05DE8 lmul(pct+100, q1)
  return u32(sdiv(p2, 200));                                  // 0x05DEF sdiv(·, 200)
}

/**
 * 원본 0x05D44 를 옮긴 것.
 *
 * @param dg        DGROUP 0x10000 바이트. 탱크 배열(0x43FC)·카탈로그(0x5DC)·인원수(0x4D73).
 * @param tankIndex [bp+8]. 칸을 그리는 탱크. 경계 검사 없음 (음수면 감긴다).
 * @param outPtr    [bp+6]. 고른 품목 번호를 쓸 DGROUP 오프셋.
 * @returns         고른 품목 수 (바이트, AL).
 */
export function drawShopTankPanel(dg            , tankIndex        , outPtr        )         {
  const ti = sbyte(tankIndex);                                         // [bp+8] 은 바이트, 0x05D4A cbw
  const tankOff = u16(ti * TANK_STRIDE);                               // 0x05D4A..0x05D53
  const multiplier = dg[u16(tankOff + TANK_BASE + T_EQUIP)] !== 0 ? 3 : 4; // 0x05D55

  let count = 0;                                                       // [bp-2]
  for (let cat = 0; cat <= 9; cat++) {                                 // [bp-3], 0x05EF5 cmp 9 ; jg
    for (let item = 1; item <= 0x33; item++) {                         // [bp-1], 0x05EE9 cmp 0x34 ; jge
      // 품목 4·5: 크레딧이 5000 을 넘으면 뺀다 (0x05D78..0x05DA0).
      if (item === 4 || item === 5) {
        const chi = i16(u16at(dg, u16(tankOff + TANK_BASE + T_CREDIT_HI)));
        if (chi > 0) continue;                                         // 0x05D96 jg → 건너뜀
        if (chi === 0 && u16at(dg, u16(tankOff + TANK_BASE + T_CREDIT_LO)) > 0x1388) continue; // 0x05D9E jbe / 0x05DA0
        // chi < 0 이면 통과 (0x05D94 jl → 본체)
      }

      const catOff = u16(i16(item) * CAT_STRIDE);                      // 0x05DB1..0x05DBA
      const price = u32(u16at(dg, u16(catOff + C_PRICE_LO)) | (u16at(dg, u16(catOff + C_PRICE_HI)) << 16));
      let cost = costOf(dg, price, multiplier, ti);

      if (cost === 0) continue;                                        // 0x05E00 → 0x05E02
      if (i16(cost >>> 16) < 0) {                                      // 0x05E0B jl → 다시 계산
        const t01 = sbyte(dg[u16(tankOff + TANK_BASE + T_CHASSIS)]);   // 0x05E2C, cbw
        const cOff2 = u16(i16(t01) * CAT_STRIDE);                      // 0x05E31..0x05E36
        const cprice = u32(u16at(dg, u16(cOff2 + CHASSIS_PRICE_LO)) | (u16at(dg, u16(cOff2 + CHASSIS_PRICE_HI)) << 16));
        cost = costOf(dg, cprice, multiplier, ti);                     // 0x05E45..0x05E6B — 0·음수 재검사 없음
      }

      // 크레딧 < 비용 이면 뺀다 (0x05E76..0x05E93).
      const crHi = i16(u16at(dg, u16(tankOff + TANK_BASE + T_CREDIT_HI)));
      const crLo = u16at(dg, u16(tankOff + TANK_BASE + T_CREDIT_LO));
      const costHi = i16(cost >>> 16), costLo = cost & 0xffff;
      if (crHi < costHi) continue;                                     // 0x05E8C jl
      if (crHi === costHi && crLo < costLo) continue;                  // 0x05E8E jne / 0x05E93 jb

      // 카탈로그 장착 위치 == 분류 (0x05E95..0x05EA7).
      if (dg[u16(catOff + C_PORT)] !== cat) continue;

      // 분류 9: 이미 산 업그레이드는 뺀다 (0x05EA9..0x05ED3).
      if (cat === 9) {
        const actId = sbyte(dg[u16(catOff + C_ACTION)]);               // 0x05EC4, cbw
        if (dg[u16(tankOff + TANK_BASE + T_EQUIP + actId)] === 1) continue; // 0x05ECC cmp 1 ; jne 는 추가
      }

      dg[u16(outPtr + count)] = item & 0xff;                           // 0x05ED5..0x05EE1
      count++;                                                         // 0x05EE3
    }
  }
  return count & 0xff;                                                 // 0x05EFE mov al,[bp-2]
}

// ─────────────────────────────────────────────────────────────────────────────
// 원본 0x05FB3 (shop-screen, 2596명령) 재구현.
//
// 게임의 상점 화면. main(0x04DC7)의 0x04E20 한 곳에서만 부른다. 세 부분이다.
//
//  1단계 (0x05FEF..0x065B8)  로봇 자동 구매. `[0x4D73]` 명을 돌며 `[p*0x15+0x4CC0]!=0`
//    (로봇) 인 참가자마다 슬롯 루프를 돌려 크레딧을 쓴다. rand 를 많이 뽑는다. 탱크
//    레코드(크레딧·능력치·장비)를 쓴다.
//  2단계 (0x065B9..0x06631)  상점 배경. `[bp-0x32] = rand()*2//0x8000` 한 번.
//    `[0x4D67]==[0x4D68]` 갈래로 그리기 호출이 갈린다.
//  3단계 (0x06633..0x07791)  사람 참가자 상호작용 루프. `[p*0x15+0x4CC0]==0` (사람)
//    인 슬롯만 상점을 연다. 포트 0x60 에서 스캔코드를 직접 읽고(0x06C32), 화살표로
//    커서를 옮기고, 스페이스/엔터로 산다/저장/취소한다. 정상 return 0 (0x7787),
//    또는 `[bp-8]` 이 서면 return 0xFFFF (0x06672).
//
// ── 판정 경계 (CLAUDE.md 1단계) ──────────────────────────────────────────
// 이 함수가 정한 것 셋만 본다. (1) 밖으로 부른 것의 순서·인자, (2) DGROUP 에 쓴 값,
// (3) AX 로 돌려준 값. 픽셀은 안 본다. BGI(그리기 드라이버)는 한 번도 안 부른다 —
// 화면은 전부 이미 옮긴 mode-X 코드로 나간다.
//
// import 해서 그대로 부르는 것 (이미 옮겼고 dg 만 있으면 결정적): rand(randStep 로
// 씨앗을 꿴다), borland_long(sdiv·lmul·lshl), drawShopTankPanel(0x05D44),
// scorePercentFromDgroup(0x05F07). 이것들은 calls 에 안 담는다.
// 인자만 기록하는 것: panel(0x05091)·drawString(0x051A8)·image(0x0488F)·
// rectFill(0x04F0B)·loadPalette(0x049FB)·drawImage(0x04A58)·enterModeX(0x040B4)·
// outport(0x0145A)·itoa(0x031E5)·ltoa(0x03227)·delay(0x01FDA)·blockCopy(0x01191)·
// tankFileWrite(0x07792). tankFileRead(0x07875)는 반환값을 script.fileReads 가 준다.
//
// ── 스택 프레임을 바이트로 모델링한다 ──────────────────────────────────────
// 메뉴(0x054AD)와 달리 이 함수는 지역 변수를 겹쳐 쓴다. 0x67EF 의 워드 배열이
// `[bp-0x42]` 에서 시작해 `[bp-0x24]`(페이지 0/1)로 색인되는데, 쓰는 색인 `[bp-0x3E]`
// 가 2 이상이면 `[bp-0x3E]`·`[bp-0x3C]` 자기 자신을 덮는다. 게다가 격자 레코드
// 배열 둘(보폭 7)이 프레임 안에 산다 — `[bp-0x21E..]` 는 색인 si, `[bp-0x202..]` 는
// 색인 [bp-2] 인데 `0x21E-0x202 = 0x1C = 4*7` 이라 **같은 메모리를 4 레코드 어긋나게**
// 본다. "변수 하나에 지역 하나" 로는 재현이 안 된다. 원본 DS==SS 이고 스택이 DGROUP
// 꼭대기에 있으므로, dg 안 `bufBase` 부터 0x23C 바이트를 프레임으로 삼는다.
// `bufBase` 는 하니스가 세운 far-call 프레임에서 나온 값(0xFBC2)이고 골든에 적는다.
// drawShopTankPanel 이 near 포인터(`[bp-0x8E]`)에 목록을 쓰는 것도 이 프레임 뷰에
// 그대로 떨어진다.
//
// ── 안 채운 스택 / 프레임 밖 읽기 ──────────────────────────────────────────
// 커서 검증 루프(0x75A0)가 si 를 `[bp-2]+5` 까지 돌며 recArr[si].+4 를 읽는데,
// si == [bp-2]+4 칸은 격자 배치가 한 열을 다 채웠을 때만(0x6851) 1 로 채워지고
// 아니면 안 채운 값이다. 포트는 프레임을 0 으로 시작하고, 캡처도 프레임 자리를 0 으로
// 심어 원본과 맞춘다 (골든 blindSpots).
//
// 바이트 근거는 disasm/addr_0x05FB3.md. 정답표는 goldens/shop_screen_vectors_v1 이고
// port/test/shop.test.ts 가 그것으로 판정한다.

/** 프레임 안 포인터. bufBase 로부터의 오프셋(= bp 상대 음수 오프셋)으로 대조한다. */
                                        

/** runShopScreen 이 순서대로 쌓는 "밖으로 부른 것" 하나. */
                      
                                                                                    
                                                                                    
                                                                                   
                                                                                   
                                                                                   
                                                                                         
                                               
                                                                                        
                                                            
                                                                                               
                                                                                                
                                                                                   
                                                                                   
                                                                                   
                                                                                           
                                                                         // 0x07875 (반환은 script)

                             
                                                    
               
                                                        
                      
                                                                                      
                          
                                                                            
                       
                                                                     
                   
                                                         
                               
 

                             
                    
                               
                  
                             
              
 

const FRAME = 0x23c;                        // 원본 `sub sp,0x23c`

/** 카탈로그 레코드 시작 (DGROUP 절대). 0x5DC + item*0x3D. */
const CAT_STR = 0x3d;
/** 탱크 레코드 시작. 0x43FC + t*0x176. (0x05D44 의 TANK_BASE·TANK_STRIDE 와 같다) */
const SHOP_TANK0 = 0x43fc, SHOP_TANK_STR = 0x176;

/**
 * 원본 0x05FB3 를 옮긴 것.
 *
 * @param dg     DGROUP 0x10000 바이트. 카탈로그(0x5DC)·탱크(0x43FC)·참가자(0x4CC0)·
 *               제어 바이트(0x4D65/67/68/6F/73)·문자열·그리고 프레임(bufBase).
 * @param script 씨앗·스캔코드·파일읽기 반환·bufBase.
 */
export function runShopScreen(dg            , script            )             {
  const FB = (script.bufBase ?? 0xfbc2) & 0xffff;
  const calls             = [];
  const out = (c          )       => { calls.push(c); script.emit?.(c); };
  const scans = [...script.scancodes];
  const fileRets = [...(script.fileReads ?? [])];
  let scanPos = 0;

  // ── 씨앗 실 꿰기 ──────────────────────────────────────────────────────────
  let seed = u32(script.seed);
  const draw = ()         => { const r = randStep(seed); seed = r.next; return r.result; };
  /** 원본 관용구 `rand()*n // 0x8000` (0x149D → cwd → lmul n → sdiv 0x8000). */
  const randN = (n        )         => u32(sdiv(lmul(u32(draw()), n), 0x8000));

  // ── 프레임 접근자 (bp 상대 오프셋 off → dg[FB + 0x23C - off]) ──────────────
  const fa = (off        )         => u16(FB + FRAME - off);      // [bp-off] 의 dg 주소
  const g8 = (off        )         => dg[fa(off)];
  const gi8 = (off        )         => sbyte(dg[fa(off)]);
  const s8 = (off        , v        )       => { dg[fa(off)] = v & 0xff; };
  const g16 = (off        )         => dg[fa(off)] | (dg[u16(fa(off) + 1)] << 8);
  const gi16 = (off        )         => i16(g16(off));
  const s16 = (off        , v        )       => {
    const a = fa(off); dg[a] = v & 0xff; dg[u16(a + 1)] = (v >> 8) & 0xff;
  };
  // 프레임 안 배열 원소: 절대 dg 주소로 다룬다 (색인이 프레임을 넘어도 16비트로 접힌다).
  const A8 = (addr        )         => dg[u16(addr)];
  const A16 = (addr        )         => dg[u16(addr)] | (dg[u16(addr + 1)] << 8);
  const wA16 = (addr        , v        )       => {
    dg[u16(addr)] = v & 0xff; dg[u16(addr + 1)] = (v >> 8) & 0xff;
  };
  /** recArr[i] 의 필드 f 의 dg 주소. base [bp-0x21E], 보폭 7. */
  const rec = (i        , f        )         => u16(fa(0x21e) + i * 7 + f);
  /** [bp-0x202] 배열(색인 [bp-2]) — recArr 를 4 레코드 어긋나게 본 것. */
  const recC = (i        , f        )         => u16(fa(0x202) + i * 7 + f);

  const dgw = (at        )         => dg[u16(at)] | (dg[u16(at + 1)] << 8);
  const catBase = (item        )         => u16(i16(item) * CAT_STR);   // cbw;imul 0x3d — 경계 검사 없음
  const tankBase = (t        )         => u16(i16(t) * SHOP_TANK_STR);

  /** 32비트 부호 있는 값을 dg 의 [lo],[hi] 두 워드에서 빼고 빌림 전파 (sub/sbb). */
  const sub32 = (loAt        , hiAt        , v        )       => {
    const cur = A16(loAt) | (A16(hiAt) << 16);
    const r = u32(cur - u32(v));
    wA16(loAt, r & 0xffff); wA16(hiAt, (r >>> 16) & 0xffff);
  };
  const add32 = (loAt        , hiAt        , v        )       => {
    const cur = A16(loAt) | (A16(hiAt) << 16);
    const r = u32(cur + u32(v));
    wA16(loAt, r & 0xffff); wA16(hiAt, (r >>> 16) & 0xffff);
  };

  /** 비용식 한 번 — 0x05D44 의 costOf 와 같다 (0x6DBD..0x6E13 / 0x6E24..0x6E83). */
  const cost1 = (price        , mult        , ti        )         => {
    const q1 = sdiv(lmul(u32(mult), price), 4);
    const pct = u16(scorePercentFromDgroup(dg, ti) + 0x64);
    const p2 = lmul(u32(i16(pct)), q1);
    return u32(sdiv(p2, 200));
  };
  /** 품목 비용. 첫 계산이 음수면 차체 카탈로그 가격으로 다시 계산 (0x6E16 분기). */
  const itemCost = (item        , mult        , ti        )         => {
    const cb = catBase(item);
    const price = u32(dgw(u16(cb + 0x615)) | (dgw(u16(cb + 0x617)) << 16));
    let c = cost1(price, mult, ti);
    if (i16(c >>> 16) < 0) {
      const chassis = sbyte(dg[u16(tankBase(ti) + SHOP_TANK0 + 0x01)]);
      const cb2 = catBase(chassis);
      const cp = u32(dgw(u16(cb2 + 0x746)) | (dgw(u16(cb2 + 0x748)) << 16));
      c = cost1(cp, mult, ti);
    }
    return c;
  };

  const bufRel = (ptr        )         => ({ bufRel: (u16(ptr) - FB) & 0xffff });

  // ── 프롤로그 (0x05FB3..0x05FE7) ──────────────────────────────────────────
  s8(0x23, 0xff); s8(0x24, 0); s16(0x44, 0); s8(0x08, 0); s8(0x25, 0); s8(0x26, 0x0c);
  // 0x05FE3 memcpy [bp-0x23c] <- DS:0x1CFD, 0x1E
  dg.copyWithin(fa(0x23c), 0x1cfd, 0x1cfd + 0x1e);
  out({ fn: "blockCopy", dst: bufRel(fa(0x23c)), src: 0x1cfd, n: 0x1e });

  // ═══ 1단계 — 로봇 자동 구매 (0x05FEF..0x065B8) ═══════════════════════════
  for (s8(1, 0); gi8(1) < sbyte(dg[0x4d73]); s8(1, g8(1) + 1)) {   // 0x65AD/0x65B0 cbw;cmp;jge
    const p = gi8(1);
    const precAt = u16(u16(i16(p) * 0x15) + 0x4cc0);               // 0x05FEF cbw;imul 0x15
    if (dg[precAt] === 0) continue;                                 // 0x05FFA cmp 0 ; jne → 아니면 skip

    for (s8(0x48, 0); ; s8(0x48, g8(0x48) + 1)) {
      // 0x6568 슬롯 상한: (3 - (participant==1?1:0)) + (sbyte([0x4D67])>3 ? 0 : 10)
      const bound = (3 - (dg[precAt] === 1 ? 1 : 0)) + (sbyte(dg[0x4d67]) > 3 ? 0 : 10);
      if (i16(sbyte(g8(0x48))) >= bound) break;                     // 0x65A3 cmp ax,dx ; jge

      // 0x600B — 분류 선택 [bp-0x45].
      if (randN(6) === 0) s8(0x45, 1);                              // 0x602D or ax,ax ; jne
      else s8(0x45, (randN(7) + 1) & 0xff);                         // 0x6037: rand*7//0x8000 + 1
      if (g8(0x48) === 0) s8(0x45, 0);                              // 0x605E
      if (g8(0x48) === 1) {                                          // 0x606E: tank +0x53 word < 0x78 (부호 있는 jge)
        if (i16(A16(u16(tankBase(p) + 0x444f))) < 0x78) s8(0x45, 1);
      }
      if (g8(0x48) > 3) s8(0x45, 9);                                // 0x6084 cmp 3 ; jle

      // 0x608E — rand*0x50//0x8000 == 0 이면 tank +0x3A 를 1 로.
      if (randN(0x50) === 0) {                                       // 0x60B0 or ax,ax ; jne
        const t3a = u16(tankBase(p) + 0x4436);
        if (sbyte(dg[t3a]) === 0) dg[t3a] = 1;                       // 0x60C4 cwde;or;jne → 0 이면 set
      }

      const tbP = u16(tankBase(p));
      if (sbyte(dg[u16(tbP + 0x443c)]) === 0) {                      // 0x60D8 cwde;or;je 0x60EF ; jmp 0x6178
        // 0x60EF — rand*3//0x8000 == 0 이고 참가자 유형 ∈ {2,4,5} 이면 크레딧에서 0x320.
        if (randN(3) === 0) {                                        // 0x6113 or ax,ax ; jne 0x6178
          const kind = sbyte(dg[precAt]);                            // 0x6120 cwde
          if (kind === 2 || kind === 5 || kind === 4) {              // 0x6127..0x6134
            const hi = A16(u16(tbP + 0x442e));
            const lo = A16(u16(tbP + 0x442c));
            // 0x6141 cmp hi,0 ; jl 0x6178 ; jg 0x6152 ; cmp lo,0x320 ; jbe 0x6178
            if (!(i16(hi) < 0 || (i16(hi) === 0 && lo <= 0x320))) {
              dg[u16(tbP + 0x443c)] = 1;                             // 0x615D
              sub32(u16(tbP + 0x442c), u16(tbP + 0x442e), 0x320);    // 0x616D sub ; 0x6173 sbb 0
            }
          }
        }
      }

      // 0x6178 — rand*0xF//0x8000 == 0 이고 tank +0x38 == 0 이면 크레딧에서 0x4B0.
      if (randN(0xf) === 0) {                                        // 0x619A or ax,ax ; jne 0x61F4
        if (sbyte(dg[u16(tbP + 0x4434)]) === 0) {                    // 0x61AD cwde;or;jne
          const hi = A16(u16(tbP + 0x442e));
          const lo = A16(u16(tbP + 0x442c));
          if (!(i16(hi) < 0 || (i16(hi) === 0 && lo <= 0x4b0))) {    // 0x61BD..0x61CC
            dg[u16(tbP + 0x4434)] = 1;                               // 0x61D9
            sub32(u16(tbP + 0x442c), u16(tbP + 0x442e), 0x4b0);      // 0x61E9/0x61EF
          }
        }
      }

      // 0x61F4 — 분류 행의 세 칸을 훑어 살 것을 고른다.
      s16(0x36, 0);                                                  // [bp-0x36] = 0
      let bought = false;                                            // [bp-0x36] != 0 이면 산 것
      let col = 0;                                                   // [bp-0x46]
      for (; col < 3; col++) {                                        // 0x63AB cmp 3 ; jge
        s8(0x46, col);
        let sel        ;                                             // [bp-0x47]
        if (dg[precAt] === 1 && g8(0x45) === 6) {                    // 0x6200/0x6212
          sel = (u16(sdiv(lshl(u32(draw()), 2), 0x8000)) + 0x23) & 0xff;   // 0x621F: rand<<2//0x8000 + 0x23
        } else {
          // 0x6237 — blob[[bp-0x45]*3 + [bp-0x46]]
          sel = A8(u16(fa(0x23c) + i16(g8(0x45)) * 3 + i16(g8(0x46))));
        }
        s8(0x47, sel);
        if (g8(0x47) === 6 && randN(0x14) === 0) s8(0x47, 7);        // 0x6253/0x6259/0x627F
        if (g8(0x47) === 0x34 && dg[precAt] === 5) s8(0x47, 0x13);   // 0x6283..0x629B
        if (g8(0x47) === 0x2a) {                                     // 0x629F
          // 0x62B9 idiv 2 : 짝수면 0x62D1 ; 홀수면 0x62BF 에서 참가자==5 일 때만 0x62D1.
          if (sbyte(dg[precAt]) % 2 === 0 || dg[precAt] === 5)
            s8(0x47, 0x28);                                          // 0x62D1
        }
        if (dg[precAt] === 3 && g8(0x47) === 0x1d) { continue; }     // 0x62D5..0x62ED jmp 0x63A8
        if (g8(0x47) === 0) { continue; }                            // 0x62F0..0x62F6 jmp 0x63A8

        if (gi8(0x45) >= 1 && gi8(0x45) <= 7) {                      // 0x62F9..0x6303
          const slotB = u16(tankBase(p) + 0x4445 + i16(g8(0x45)));
          if (!(sbyte(dg[slotB]) < gi8(0x47))) {                     // 0x6316 cmp al,[bp-0x47] ; jl → 계속
            if (g8(0x46) !== 0) { s16(0x36, 1); bought = true; break; }  // 0x631F..0x632A jmp 0x63B4
            const slotW = u16(tankBase(p) + 0x444d + i16(g8(0x45)) * 2);
            if (A16(slotW) > 0xc8) { s16(0x36, 1); bought = true; break; } // 0x6340 cmp 0xc8 ; jle → 아니면 abort
          }
        }
        if (g8(0x45) === 0) {                                         // 0x634A
          const chassis = sbyte(dg[u16(tankBase(p) + SHOP_TANK0 + 0x01)]);
          if (!(sbyte(chassis) < sbyte(dg[u16(catBase(g8(0x47)) + 0x614)]))) continue; // 0x636C jl → 계산; 아니면 0x63A8
        }
        // 0x6374 — 카탈로그[sel].price(32b, +0x39) <= 탱크 크레딧(32b, +0x2C) ?
        {
          const cb = catBase(g8(0x47));
          const priceLo = A16(u16(cb + 0x615)), priceHi = A16(u16(cb + 0x617));
          const tb = u16(tankBase(p));
          const crHi = A16(u16(tb + 0x442e)), crLo = A16(u16(tb + 0x442c));
          // 0x6396 cmp dx,[+0x442e] ; jl 0x63A6 ; jg 0x63A4 ; cmp ax,[+0x442c] ; jbe 0x63A6
          const canBuy = i16(priceHi) < i16(crHi)
            || (i16(priceHi) === i16(crHi) && priceLo <= crLo);
          if (canBuy) break;                                         // 0x63A6 jmp 0x63B4 (buy)
          continue;                                                  // 0x63A4 jmp 0x63A8 (next col)
        }
      }

      // 0x63B4 — 살 것인가. [bp-0x46]!=3 && [bp-0x36]==0
      if (col < 3 && !bought) {
        // 0x63C3 — 크레딧 -= 카탈로그[sel].price
        const cb = catBase(g8(0x47));
        const price = u32(A16(u16(cb + 0x615)) | (A16(u16(cb + 0x617)) << 16));
        const tb = u16(tankBase(p));
        sub32(u16(tb + 0x442c), u16(tb + 0x442e), price);           // 0x63E4 sub ; 0x63E9 sbb

        const c45 = g8(0x45);
        if (gi8(0x45) >= 1 && gi8(0x45) <= 8) {                     // 0x63ED..0x63FA
          const slotB = u16(tb + 0x4445 + i16(c45));
          const slotW = u16(tb + 0x444d + i16(c45) * 2);
          if (sbyte(dg[slotB]) === gi8(0x47)) {                     // 0x6410 cmp al,[bp-0x47] ; jne
            wA16(slotW, u16(A16(slotW) + 0x7d));                    // 0x642C add 0x7d
          } else {
            dg[slotB] = g8(0x47) & 0xff;                            // 0x6444
            const tankScoreHi = A16(u16(tb + 0x4426));              // 0x6466 [+0x28] 32b score
            const tankScoreLo = A16(u16(tb + 0x4424));
            const big = i16(tankScoreHi) < 0
              || (i16(tankScoreHi) === 0 && tankScoreLo <= 0x1f4) ? 0 : 1;  // 0x646A..0x6479
            wA16(slotW, u16(big * 0x19 + 0x64));                    // 0x6482 imul 0x19 ; add 0x64
          }
        }
        if (c45 === 9) add32(u16(tb + 0x4424), u16(tb + 0x4426), 0x9c4);  // 0x6495
        if (c45 === 0) {                                             // 0x64B4 — 차체 교체
          // tb = tankBase(p) = p*0x176 (레코드 배열 베이스 0x43FC 는 오프셋에 포함시킨다).
          const cb0 = catBase(g8(0x47));
          dg[u16(tb + 0x43fd)] = dg[u16(cb0 + 0x614)];               // 0x64D0  차체 = cat.+0x38
          wA16(u16(tb + 0x4419), A16(u16(cb0 + 0x612)));             // 0x64F0  +0x1D w = cat.+0x36
          wA16(u16(tb + 0x441b), u16(i16(sbyte(dg[u16(cb0 + 0x611)]))));// 0x6511  +0x1F w = cat.+0x35 sx
          dg[u16(tb + 0x441d)] = dg[u16(cb0 + 0x60f)];               // 0x6531  +0x21 b = cat.+0x33
          dg[u16(tb + 0x4432)] = 0; dg[u16(tb + 0x4433)] = 0; dg[u16(tb + 0x4434)] = 0;  // 0x6540/4E/5C
        }
      }
    }
  }

  // ═══ 2단계 — 배경 (0x065B9..0x06631) ═══════════════════════════════════
  // 0x65BE: rand() → cwd → shl ax,1 ; rcl dx,1 → sdiv(_, 0x8000). rand<0x8000 이므로 늘 0.
  s16(0x32, u16(sdiv(u32(draw()) * 2, 0x8000)));
  if (dg[0x4d67] === dg[0x4d68]) {                                    // 0x65D4 cmp al,[0x4d68] ; je 0x660C
    out({ fn: "image", name: 0x2260, aLo: 0x136, aHi: 0, bLo: 0x148, bHi: 0, extra: 0 }); // 0x6622
  } else {
    out({ fn: "enterModeX", a: 3 });                          // 0x65E1
    out({ fn: "outport", port: 0x3d4, value: 0x800c });       // 0x65ED
    out({ fn: "loadPalette", name: 0x224e });                 // 0x65F9
    out({ fn: "drawImage", name: 0x2257, page: g16(0x32) });  // 0x6605
  }
  s8(0x27, 1);                                                        // 0x6628

  // ═══ 3단계 — 사람 참가자 상호작용 (0x06633.., 루프 머리 0x7767) ═══════════
  const ret = phase3();
  return { calls, endSeed: seed >>> 0, ret };

  // ── 3단계 본문 (클로저로 위 상태를 그대로 쓴다) ──────────────────────────
  function phase3()         {
    for (s8(1, 0); ; s8(1, g8(1) + 1)) {
      const bound = 3 - (dg[0x4d73] === 2 ? 1 : 0);                  // 0x7767
      if (i16(sbyte(g8(1))) >= bound) return 0;                      // 0x7782 jge 0x7787 → return 0

      dg.copyWithin(fa(0x4e), 0x1d1b, 0x1d1b + 0xa);                 // 0x6640
      out({ fn: "blockCopy", dst: bufRel(fa(0x4e)), src: 0x1d1b, n: 0xa });
      dg.copyWithin(fa(0x58), 0x1d25, 0x1d25 + 0xa);                 // 0x6652
      out({ fn: "blockCopy", dst: bufRel(fa(0x58)), src: 0x1d25, n: 0xa });

      const p = gi8(1);
      const precAt = u16(u16(i16(p) * 0x15) + 0x4cc0);
      if (dg[precAt] !== 0) continue;                                // 0x6657 je 0x666C ; jmp 0x7764 (로봇 슬롯)
      if (g8(0x08) !== 0) return 0xffff;                             // 0x666C jne → ax=0xffff ; jmp 0x778c

      for (let i = 0; i < 0x34; i++) { wA16(rec(i, 0), 0); wA16(rec(i, 2), 0); }  // 0x6678

      s8(2, drawShopTankPanel(dg, gi8(1), fa(0x8e)));                // 0x66A8 → [bp-2] = 개수
      s8(0x2b, dg[u16(tankBase(p) + 0x4431)] === 0 ? 4 : 3);        // 0x66BA

      const nameStr = u16(u16(i16(p) * 0x15) + 0x4cc1);
      const tb0 = u16(tankBase(p));
      out({ fn: "panel", x: 0x11, y: 0x174, str: 0x226a, lo: 0, hi: 0, flag: 0, colour: 2 });
      out({ fn: "panel", x: 0x75, y: 0x174, str: 0x226f, lo: 0, hi: 0, flag: 0, colour: 2 });
      out({ fn: "panel", x: 0x11, y: 0x156, str: bufRel(fa(0x4e)), lo: 0, hi: 0, flag: 0, colour: 2 });
      out({ fn: "panel", x: 0x75, y: 0x156, str: bufRel(fa(0x58)), lo: 0, hi: 0, flag: 0, colour: 2 });
      out({ fn: "panel", x: 0xd9, y: 0x156, str: nameStr, lo: 0, hi: 0, flag: 0, colour: 3 });
      out({ fn: "panel", x: 0xd9, y: 0x174, str: 0x227a,
        lo: A16(u16(tb0 + 0x442c)), hi: A16(u16(tb0 + 0x442e)), flag: 0, colour: 3 });

      buildGrid(p);
      if (keyLoop(p) === "return0") return 0;                         // 0x6CF6 tankFileRead != 0 → 0x7787

      if (g8(9) !== 0) s8(1, g8(1) - 1);                             // 0x7736 cmp 0 ; je ; dec [bp-1]
      if (g8(9) === 2) { s8(0x25, 0); s8(0x26, 8); }                 // 0x773F..0x7749
      else { s8(0x25, 0); s8(0x26, 0x0c); s8(0x24, 0); }            // 0x774F..0x7757
      if (g8(0x08) !== 0) return 0xffff;                             // 0x775B jne → jmp 0x6672
    }
  }

  // ── 격자 레코드 배열을 짠다 (0x679C..0x6A21) ────────────────────────────
  function buildGrid(p        )       {
    s16(0x3a, 0); s16(0x34, 0); s16(0x3e, 0); s16(0x3c, 0); s16(0x42, 0); s16(0x40, 0); // 0x679C
    // 0x67BA — 첫 품목의 장착 위치가 0 이 아니면 [bp-0x3c] 를 올린다.
    if (dg[u16(catBase(gi8(0x8e)) + 0x60e)] !== 0) s16(0x3c, u16(g16(0x3c) + 1));
    if (gi8(2) < 0x18) s8(0x24, 0);                                 // 0x67D0 cmp 0x18 ; jge → 아니면 [bp-0x24]=0

    // 0x67DF — 품목마다 격자 칸 하나. si 0..[bp-2].
    for (let si = 0; i16(sbyte(g8(2))) > si; si++) {                // 0x6929 cbw ; cmp ax,si ; jle
      s16(0x36, i16(sbyte(dg[u16(fa(0x8e) + si)])));                // item# = itemList[si]  (cbw)
      s16(0x38, i16(sbyte(dg[u16(fa(0x8e) + si + 1)])));            // peek 다음  ([bp+si-0x8d])
      wA16(u16(fa(0x42) + g16(0x3e) * 2), g16(0x34));               // 0x67EF wordArr[[bp-0x3e]] = [bp-0x34]
      if (g16(0x34) === 8) {                                         // 0x67FE
        wA16(fa(0x42), 7);                                          // 0x6804 wordArr[0] = 7
        s16(0x3e, u16(g16(0x3e) + 1));                              // 0x6809
        s16(0x3a, 0); s16(0x34, 0);                                 // 0x680C/0x6811
        wA16(recC(g8(2), 0), 0x11);                                 // 0x6816 recArr[[bp-2]+4].+0
        wA16(recC(g8(2), 2), 0xfc);                                 // 0x682B .+2
        dg[recC(g8(2), 4)] = 1;                                     // 0x6840 .+4
      }
      wA16(rec(si, 0), u16((i16(g16(0x3a)) % 3) * 0x64 + 0x11));    // 0x6854
      wA16(rec(si, 2), u16(i16(g16(0x34)) * 0x1e + 0xc));           // 0x6878
      dg[rec(si, 4)] = g8(0x3e) & 0xff;                             // 0x6894 (dl = [bp-0x3e] 하위)
      dg[rec(si, 5)] = g8(0x3c) & 0xff;                             // 0x68A8
      dg[rec(si, 6)] = g8(0x36) & 0xff;                             // 0x68BC (item#)
      s16(0x3a, u16(g16(0x3a) + 1));                                // 0x68D0
      if (i16(g16(0x3a)) % 3 === 0) s16(0x34, u16(g16(0x34) + 1));  // 0x68D3
      const mountHere = dg[u16(catBase(gi16(0x36)) + 0x60e)];       // 0x68E3
      const mountNext = dg[u16(catBase(gi16(0x38)) + 0x60e)];       // 0x68F2
      if (mountHere === mountNext) continue;                         // 0x6901 je → inc si
      if (mountHere === 0 || mountNext === 9) s16(0x3c, u16(g16(0x3c) + 1)); // 0x6903..0x6925
    }

    // 0x6934 — 격자 밖 네 칸 (저장·불러오기·완료·취소 자리). +4 = 1.
    for (let si2 = 0; si2 < 2; si2++) {                             // 0x69B3
      for (s16(0x36, 0); i16(g16(0x36)) < 2; s16(0x36, u16(g16(0x36) + 1))) {  // 0x69AC
        const idx = u16(i16(sbyte(g8(2))) + si2 + i16(g16(0x36)) * 2);
        wA16(rec(idx, 0), u16(si2 * 0x64 + 0x11));                  // 0x6957
        wA16(rec(idx, 2), u16(i16(g16(0x36)) * 0x1e + 0x156));      // 0x697E
        dg[rec(idx, 4)] = 1;                                        // 0x69A6
      }
    }

    // 0x69B8 — 페이지의 행 머리 이미지. si = [bp-0x44] 에서 wordArr[page] 까지 내려가며.
    let si = g16(0x44);                                             // 0x69B8
    while (i16(A16(u16(fa(0x42) + i16(sbyte(g8(0x24))) * 2))) <= i16(si)) {  // 0x6A11 cbw;shl;cmp;jle
      const aLo = u16(i16(si) * 0x1e + 0xa), bLo = u16(i16(si) * 0x1e + 0x1c);
      const aHi = i16(aLo) < 0 ? 0xffff : 0, bHi = i16(bLo) < 0 ? 0xffff : 0;  // cwd
      if (dg[0x4d67] === dg[0x4d68]) {                              // 0x69C4 jne 0x69E8
        out({ fn: "image", name: 0x2280, aLo, aHi, bLo, bHi, extra: 0 });
      } else {
        out({ fn: "image", name: 0x228a, aLo, aHi, bLo, bHi, extra: g16(0x32) });
      }
      si = u16(si - 1);                                             // 0x6A10 dec si
    }

    // 0x6A22 — [bp-0x27] 이 서 있으면 outport(0x3d4, 0xc).
    if (g8(0x27) !== 0) out({ fn: "outport", port: 0x3d4, value: 0x0c });
    // 0x6A37 — [bp-0x44] = wordArr[page].
    s16(0x44, A16(u16(fa(0x42) + i16(sbyte(g8(0x24))) * 2)));
    // 0x6A49 — 개수 <= 0x18 이면 배경 이미지, 아니면 안내판. `cmp [bp-2],0x18 ; jle 0x6A6E`.
    if (i16(sbyte(g8(2))) <= 0x18) {
      if (dg[0x4d67] === dg[0x4d68]) {                               // 0x6A6E cmp ; jne 0x6A8D
        out({ fn: "image", name: 0x229d, aLo: 0xfa, aHi: 0, bLo: 0x10c, bHi: 0, extra: 0 });   // 0x6A77
      } else {
        out({ fn: "image", name: 0x22a7, aLo: 0xfa, aHi: 0, bLo: 0x10c, bHi: 0, extra: g16(0x32) }); // 0x6A8D
      }
    } else {
      out({ fn: "panel", x: 0x11, y: 0xfc, str: 0x2293, lo: 0, hi: 0, flag: 0, colour: 2 }); // 0x6A4F
    }

    // 0x6AA9 — 현재 페이지의 품목 판을 그린다.
    for (let si3 = 0; i16(sbyte(g8(2))) > si3; si3++) {              // 0x6BFB cbw ; cmp ax,si ; jle
      if (dg[rec(si3, 4)] !== g8(0x24)) continue;                    // 0x6ABF cmp al,[bp-0x24] ; je → 아니면 skip
      const item = dg[rec(si3, 6)];
      const cb = catBase(i16(sbyte(item)));                          // cbw ; imul 0x3d
      const x = A16(rec(si3, 0)), y = A16(rec(si3, 2));
      const str = u16(cb + 0x5dc);                                   // 0x6BCD add ax,0x5dc
      if (dg[rec(si3, 5)] === 1) {                                   // 0x6AD6 cmp 1 ; jne 0x6B57
        // 갈래 A: 능력치 슬롯 표시.
        s16(0x36, i16(sbyte(dg[u16(cb + 0x60e)])));                  // [bp-0x36] = cat.+0x32 (cbw)
        const slotB = u16(tankBase(p) + g16(0x36));                  // 0x6B0B add ax,[bp-0x36]
        const eq = sbyte(dg[u16(slotB + 0x4445)]) === i16(sbyte(item)) ? 1 : 0;  // 0x6B25 cmp al,[bx](=item#)
        const slotW = u16(tankBase(p) + g16(0x36) * 2 + 0x444d);
        // 0x6B4B `imul dx` 뒤 0x6B50 `cwd` 가 곱의 상위 워드를 덮으므로 곱은 하위 16비트만 산다.
        const prod16 = u16(eq * i16(u16(A16(slotW) + 9)));          // dx = [+0x444d]+9
        const quot = Math.trunc(i16(prod16) / 10);                  // idiv 10 (16비트 부호)
        const lo = quot & 0xffff, hi = quot < 0 ? 0xffff : 0;       // 0x6B53 cwd → push dx ; 0x6BB5 push ax
        out({ fn: "panel", x, y, str, lo, hi, flag: 0, colour: 5 });
      } else {
        // 갈래 B: [bp-0x59] = 2/4/6.
        let c59        ;
        if (dg[rec(si3, 5)] === 0) {                                 // 0x6B66 cmp 0 ; jne 0x6BA7
          const actId = dg[u16(cb + 0x614)];                        // cat.+0x38
          c59 = (actId & 0xff) === dg[u16(tankBase(p) + 0x43fd)] ? 2 : 4; // 0x6B95 cmp al,[bx+0x43fd] 바이트
        } else {
          c59 = 6;                                                  // 0x6BA7
        }
        out({ fn: "panel", x, y, str, lo: 0, hi: 0, flag: 0, colour: c59 });
      }
    }
  }

  // ── 키 루프 (0x06C06..0x07733) ─────────────────────────────────────────────
  // "turn" = 그 사람 차례가 끝났다 (0x7736 꼬리로), "return0" = 곧장 return 0 (0x7787).
  function keyLoop(p        )                     {
    // 0x6C0C — 커서 현재/대기 초기화.
    s8(4, g8(0x25) - 1); s8(6, g8(0x25)); s8(5, g8(0x26)); s8(7, g8(0x26));
    s8(9, 0);                                                          // 0x6C26
    s16(0x2a, 0);                                                      // 0x6C2A

    for (;;) {
      // 0x6C2F — in al,0x60 → [bp-3]
      if (script.readPort) s8(3, script.readPort() & 0xff);
      else {
        if (scanPos >= scans.length)
          throw new Error("runShopScreen: script.scancodes 소진 — 상점을 못 빠져나갔다");
        s8(3, scans[scanPos++] & 0xff);
      }

      // 0x6C36 — rand 처닝 (키마다 한 번). churn == 0 이면 조용 카운터 올림.
      const div = sdiv(i16(dg[0x4d6f] | (dg[0x4d70] << 8)), 0xa);
      const churn = u32(sdiv(lmul(u32(draw()), div), 0x8000));
      if (churn === 0) s16(0x2a, u16(g16(0x2a) + 1));                  // 0x6C61
      if (i16(g16(0x2a)) > 0x96) { s16(0x2a, 0); s8(3, 0x49); }       // 0x6C64 자동 스크롤
      // 0x6C76/0x6C7B — while(kbhit()) getch() : 입력 배관, 재현 안 함.

      const sc = g8(3);
      // 0x6C84 — 화살표. [bp-4]/[bp-5](현재) → [bp-6]/[bp-7](대기).
      if (sc === 0x48) s8(7, g8(5) - 1);                              // UP
      if (sc === 0x50) s8(7, g8(5) + 1);                              // DOWN
      if (sc === 0x4b) s8(6, g8(4) - 1);                              // LEFT
      if (sc === 0x4d) s8(6, g8(4) + 1);                              // RIGHT

      // 0x6CBC — 스페이스(0x39)/엔터(0x1C) 만 갈래로.
      if (sc === 0x39 || sc === 0x1c) {
        const c4 = g8(4), c5 = g8(5);
        if (c4 === 0 && c5 === 0x0b) {                                // (0,11) 저장
          out({ fn: "tankFileWrite" });                        // 0x6CD9
          s8(5, g8(5) + 1);                                           // 0x6CDC
        } else if (c4 === 1 && c5 === 0x0b) {                         // (1,11) 불러오기
          out({ fn: "tankFileRead" });                         // 0x6CEF
          if (fileRets.length === 0)
            throw new Error("runShopScreen: script.fileReads 소진 — tankFileRead 갈래가 대본보다 많이 났다");
          if ((fileRets.shift()  & 0xffff) !== 0) return "return0";   // 0x6CF6 jmp 0x7787 → return 0
          s8(5, g8(5) + 1);                                           // 0x6CFB
        } else if (c4 === 0 && c5 === 0x0c) {                         // (0,12) 완료
          return "turn";                                              // 0x6D0C jmp 0x7736 ([bp-9]=0)
        } else if (c4 === 1 && c5 === 0x0c) {                         // (1,12) 취소
          s8(0x08, 1);                                                // 0x6D1D [bp-8]=1
          return "turn";                                              // jmp 0x7736 → 꼬리가 return 0xFFFF
        } else if (c4 === 0 && c5 === 8) {                            // (0,8) 페이지 전환
          s8(0x24, g8(0x24) === 0 ? 1 : 0);                           // 0x6D32 neg;sbb;inc
          s8(9, 2);                                                   // [bp-9]=2
          return "turn";
        }
        // else 0x6D45 로 떨어진다.
        if (i16(sbyte(g8(5))) <= 7) {                                 // 0x6D45 cmp 7 ; jle 0x6D4E
          gridCellPurchase(p);                                        // 0x6D4E..0x7146
          return "turn";                                              // 0x7146 [bp-9]=1 ; jmp 0x7736
        }
        // [bp-5] > 7 → 0x714D 로.
      }

      // 0x714D — PgUp/PgDn/End/Home 상세 스크롤 (조건 안 맞으면 아무것도 안 한다).
      detailScroll(p);
      // 0x757D — 커서 이동 해소.
      cursorResolve(p);
      // 0x7733 jmp 0x6C2F — 다음 키.
    }
  }

  // ── 격자 칸 구매 (0x6D4E..0x7146) ─────────────────────────────────────────
  function gridCellPurchase(p        )       {
    let si = 0;                                                        // 0x6D4E
    for (; i16(sbyte(g8(2))) > si; si++) {                            // 0x6DAD cbw ; cmp ax,si ; jg
      if (A16(rec(si, 0)) !== u16(i16(sbyte(g8(4))) * 0x64 + 0x11)) continue;  // 0x6D6F
      if (A16(rec(si, 2)) !== u16(i16(sbyte(g8(5))) * 0x1e + 0xc)) continue;   // 0x6D90
      if (dg[rec(si, 4)] !== g8(0x24)) continue;                      // 0x6DA5
      break;                                                          // 0x6DAA
    }
    s16(0x36, i16(sbyte(dg[u16(fa(0x8e) + si)])));                    // 0x6DB5 (si 가 개수면 한 칸 넘어 읽는다)

    const cost = itemCost(gi16(0x36), g8(0x2b), gi8(1));             // 0x6DBD (+ 0x6E24 음수 재계산)
    s16(0x2e, (cost >>> 16) & 0xffff); s16(0x30, cost & 0xffff);
    const tb = u16(tankBase(gi8(1)));
    sub32(u16(tb + 0x442c), u16(tb + 0x442e), cost);                 // 0x6E86 credits -= cost

    const cb = catBase(gi16(0x36));                                   // 0x6E9F
    const mount = i16(sbyte(dg[u16(cb + 0x60e)]));
    if (mount >= 1 && mount <= 8) {                                   // 0x6E9F jl / 0x6EB3 jg
      const slotB = u16(tb + 0x4445 + mount);
      const slotW = u16(tb + 0x444d + mount * 2);
      if (i16(sbyte(dg[slotB])) === gi16(0x36)) {                    // 0x6EE8 cmp ax,[bp-0x36]
        wA16(slotW, u16(A16(slotW) + 0x64));                          // 0x6F0B
        if (i16(A16(slotW)) > 0x384) wA16(slotW, 0x384);             // 0x6F34 cmp 0x384 ; jle
      } else {
        dg[slotB] = g8(0x36) & 0xff;                                  // 0x6F7B
        wA16(slotW, 0x64);                                            // 0x6F9D
      }
    } else if (mount === 0) {                                         // 0x6FBA 차체 교체 (tb = p*0x176)
      dg[u16(tb + 0x43fd)] = dg[u16(cb + 0x614)];                     // 0x6FD3  차체 = cat.+0x38
      wA16(u16(tb + 0x4419), A16(u16(cb + 0x612)));                   // 0x6FF0  +0x1D = cat.+0x36
      wA16(u16(tb + 0x441b), u16(i16(sbyte(dg[u16(cb + 0x611)]))));   // 0x7010  +0x1F = cat.+0x35 sx
      dg[u16(tb + 0x441d)] = dg[u16(cb + 0x60f)];                     // 0x702D  +0x21 = cat.+0x33
      dg[u16(tb + 0x4432)] = 0; dg[u16(tb + 0x4433)] = 0;             // 0x703C/0x704C
      dg[u16(tb + 0x4434)] = 0; dg[u16(tb + 0x443c)] = 0;             // 0x705C/0x706C
    } else {                                                          // mount == 9 (0x7074)
      const di = i16(sbyte(dg[u16(cb + 0x614)]));                     // cat.+0x38
      if (di !== 4) dg[u16(tb + 0x4431 + di)] = 1;                    // 0x7095
      if (di === 1) wA16(u16(tb + 0x441b), u16(Math.trunc(i16(A16(u16(tb + 0x441b))) * 3 / 2)));  // 0x70A8
      if (di === 2) wA16(u16(tb + 0x4419), u16(Math.trunc(i16(A16(u16(tb + 0x4419))) * 3 / 2)));  // 0x70D8
      if (di === 3) dg[u16(tb + 0x441d)] = Math.trunc(i16(sbyte(dg[u16(tb + 0x441d)])) * 3 / 2) & 0xff; // 0x710A
      if (di === 4) add32(u16(tb + 0x4424), u16(tb + 0x4426), 0x9c4); // 0x713B
    }
    s8(9, 1);                                                         // 0x7146
  }

  // ── 상세 스크롤 (0x714D..0x757C) ──────────────────────────────────────────
  function detailScroll(p        )       {
    const sc = g8(3);
    if (!(sc === 0x49 || sc === 0x51 || sc === 0x4f || sc === 0x47)) return;  // 0x7165
    if (!(i16(sbyte(g8(5))) <= 7)) return;                            // 0x716C
    s16(0x3a, 0); s16(0x2a, 0);                                       // 0x7171

    let si = 0;                                                        // 0x717B
    for (; i16(sbyte(g8(2))) > si; si++) {                            // 0x71DA cbw ; cmp ax,si ; jg
      if (A16(rec(si, 0)) !== u16(i16(sbyte(g8(4))) * 0x64 + 0x11)) continue;  // 0x719C
      if (A16(rec(si, 2)) !== u16(i16(sbyte(g8(5))) * 0x1e + 0xc)) continue;   // 0x71BD
      if (dg[rec(si, 4)] !== g8(0x24)) continue;                      // 0x71D2
      break;                                                          // 0x71D7
    }
    s16(0x36, i16(sbyte(dg[u16(fa(0x8e) + si)])));                    // 0x71E2
    if (i16(sbyte(g8(0x23))) === gi16(0x36)) return;                  // 0x71EE je 0x7733 (이미 이것)
    s8(0x23, g8(0x36));                                               // 0x71F6

    if (dg[0x4d67] === dg[0x4d68]) {                                  // 0x71FF jne 0x721B
      out({ fn: "image", name: 0x22b0, aLo: 0x10d, aHi: 0, bLo: 0x14a, bHi: 0, extra: 0 });
    } else {
      out({ fn: "image", name: 0x22ba, aLo: 0x10d, aHi: 0, bLo: 0x14a, bHi: 0, extra: g16(0x32) });
    }
    const cb = catBase(gi16(0x36));
    out({ fn: "itoa", value: A16(u16(cb + 0x612)), dst: bufRel(fa(0x12)) });       // 0x7237
    out({ fn: "itoa", value: A16(u16(cb + 0x60f)), dst: bufRel(fa(0x1a)) });       // 0x7255
    out({ fn: "itoa", value: u16(i16(sbyte(dg[u16(cb + 0x611)]))), dst: bufRel(fa(0x22)) }); // 0x7273
    out({ fn: "drawString", x: 0x1e, y: 0x118, str: 0x22c3, colour: 2 });          // 0x7293
    out({ fn: "drawString", x: 0x64, y: 0x117, str: u16(cb + 0x5ea), colour: 0 }); // 0x72A9
    out({ fn: "drawString", x: 0x64, y: 0x118, str: u16(cb + 0x5ea), colour: 3 }); // 0x72C7

    const mnt = i16(sbyte(dg[u16(cb + 0x60e)]));
    if (mnt !== 9) {                                                  // 0x72E5 cmp 9 ; je 0x73AC
      out({ fn: "drawString", x: 0x1e, y: 0x12c, str: 0x22c8, colour: 2 });        // 0x72F9
      out({ fn: "drawString", x: 0x64, y: 0x12c, str: bufRel(fa(0x12)), colour: 3 }); // 0x730F
      let axStr        ;
      if (mnt === 0) {                                                // 0x7334 jne 0x7354
        out({ fn: "drawString", x: 0x1e, y: 0x136, str: 0x22d1, colour: 2 });      // 0x7336
        axStr = 0x22db;
      } else {
        out({ fn: "drawString", x: 0x1e, y: 0x136, str: 0x22e2, colour: 2 });      // 0x7354
        axStr = 0x22ed;
      }
      out({ fn: "drawString", x: 0x1e, y: 0x140, str: axStr, colour: 2 });         // 0x7370
      out({ fn: "drawString", x: 0x64, y: 0x136, str: bufRel(fa(0x22)), colour: 3 }); // 0x7380
      out({ fn: "drawString", x: 0x64, y: 0x140, str: bufRel(fa(0x1a)), colour: 3 }); // 0x7396
    }
    if (mnt >= 1 && mnt <= 8) {                                       // 0x73AC jl / 0x73CA jg
      out({ fn: "itoa", value: mnt & 0xffff, dst: bufRel(fa(0x12)) });             // 0x73D4 (cbw)
      out({ fn: "drawString", x: 0xa0, y: 0x12c, str: 0x22f8, colour: 2 });        // 0x73F4
      out({ fn: "drawString", x: 0xfa, y: 0x12c, str: bufRel(fa(0x12)), colour: 3 }); // 0x740A
      out({ fn: "drawString", x: 0xa0, y: 0x136, str: 0x2304, colour: 2 });        // 0x7420
      const tv = i16(sbyte(dg[u16(tankBase(gi8(1)) + 0x4445 + mnt)]));                    // 0x7455 (cbw)
      out({ fn: "drawString", x: 0xfa, y: 0x136, str: u16(i16(tv) * 0x3d + 0x608), colour: 3 }); // 0x745F
    }

    const cost = itemCost(gi16(0x36), g8(0x2b), gi8(1));             // 0x7472 (+ 0x74D9 재계산)
    s16(0x2e, (cost >>> 16) & 0xffff); s16(0x30, cost & 0xffff);
    out({ fn: "ltoa", value: cost >>> 0, dst: bufRel(fa(0x1a)) });                 // 0x753B
    out({ fn: "drawString", x: 0xa0, y: 0x140, str: 0x2310, colour: 2 });          // 0x7551
    out({ fn: "drawString", x: 0xfa, y: 0x140, str: bufRel(fa(0x1a)), colour: 3 }); // 0x7567
  }

  // ── 커서 이동 해소 (0x757D..0x7733) ───────────────────────────────────────
  function cursorResolve(_p        )       {
    if (g8(6) === g8(4) && g8(7) === g8(5)) return;                   // 0x7583/0x758B ; jmp 0x7733
    s16(0x2a, 0); s16(0x3a, 0);                                       // 0x7590

    for (let di = 1; ; di++) {                                        // 0x766F
      if (g16(0x3a) !== 0) break;
      s16(0x36, u16((i16(sbyte(g8(6))) - i16(sbyte(g8(4)))) * di + i16(sbyte(g8(4)))));  // 0x75A0
      s16(0x38, u16((i16(sbyte(g8(7))) - i16(sbyte(g8(5)))) * di + i16(sbyte(g8(5)))));
      if (i16(g16(0x36)) < 0 || i16(g16(0x38)) < 0
        || i16(g16(0x36)) > 2 || i16(g16(0x38)) > 0xc) break;         // 0x75D6..0x75EE
      for (let si = 0; i16(sbyte(g8(2))) + 5 > si; si++) {            // 0x7663 cbw ; add ax,5 ; cmp ax,si ; jg
        if (A16(rec(si, 0)) !== u16(i16(g16(0x36)) * 0x64 + 0x11)) continue;  // 0x760F
        if (A16(rec(si, 2)) !== u16(i16(g16(0x38)) * 0x1e + 0xc)) continue;   // 0x762D
        const m = dg[rec(si, 4)];
        if (m === g8(0x24) || m === 1) { s16(0x3a, 1); break; }       // 0x7645 je / 0x7659 jne
      }
    }

    if (g16(0x3a) === 0) {                                            // 0x7678 ; jmp 0x7727
      s8(6, g8(4)); s8(7, g8(5));                                     // 0x7727/0x772D
      return;
    }
    s8(6, g8(0x36)); s8(7, g8(0x38));                                 // 0x7681 대기 = 마지막으로 유효한 칸
    if (gi8(4) !== -1) {                                              // 0x768D cmp 0xff ; je 0x76D1
      out({ fn: "rectFill",                                    // 0x7693 옛 커서 지우기
        a: u16(i16(sbyte(g8(4))) * 0x64 + 0x10), b: u16(i16(sbyte(g8(5))) * 0x1e + 0xb),
        c: u16(i16(sbyte(g8(4))) * 0x64 + 0x66), d: u16(i16(sbyte(g8(5))) * 0x1e + 0x1b), e: 0 });
    }
    out({ fn: "rectFill",                                      // 0x76D1 새 커서
      a: u16(i16(sbyte(g8(6))) * 0x64 + 0x10), b: u16(i16(sbyte(g8(7))) * 0x1e + 0xb),
      c: u16(i16(sbyte(g8(6))) * 0x64 + 0x66), d: u16(i16(sbyte(g8(7))) * 0x1e + 0x1b), e: 1 });
    s8(4, g8(6)); s8(5, g8(7));                                       // 0x770F
    out({ fn: "delay", ms: 0xb4 });                            // 0x771B
    s8(7, g8(5));                                                     // 0x772D
  }
}
