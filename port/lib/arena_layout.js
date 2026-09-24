// 원본 DZONE.EXE 의 경기장 배치와 첫 그리기 0x084EB 를 재구현한다.
//
// 부르는 곳은 0x08425 하나이고 그 자리는 라운드 설정 0x07C95 의 6단계다. 라운드마다
// 한 번 돈다. retf 하나로 끝나고 exit 갈래는 없다.
//
// ── 이 함수가 하는 일 (전에는 analysis/arena_layout.md 에 있었다) ──────────────
//
// 1. 경기장과 오른쪽 상태 칸을 setfillstyle+bar 로 칠하고, setcolor 를 번갈아 rectangle
//    셋으로 테두리를 그린다.
// 2. 참가자 수(DGROUP 0x4D73)만큼 0x1261B(0, k) 를 불러 상태 칸을 그린다.
// 3. 0x0E128(1) 을 부른다 (탱크 이동과 그리기).
// 4. 팀 모드(DGROUP 0x4D65 != 0)일 때만 — 0x1229C(1) 을 부르고 표식 둘 둘레에 색 9 로
//    11x11 rectangle 을 그린다.
// 5. 배치 형태와 장애물 개수를 난수로 정한다. 형태 = rand()*7/32768 (0..6). 형태가 6 이면
//    rand()*2/32768 + 4 로 다시 뽑아 4 또는 5. 개수는 형태별 상수식이다.
// 6. 장애물마다 도는 루프. 형태 1/3/5 와 형태 2/4 가 서로 다른 산술로 자리와 크기를 난수로
//    뽑는다. 그 자리를 0x08F99(가로 훑기) 또는 0x046CA(세로 선 탐침, 형태 3 만)로 검사한다.
//    비어 있지 않으면 그 장애물을 건너뛴다. 받아들이면 채운 상자와 테두리와 선 넷으로 그린다.
//    형태 0 이면 개수가 0 이라 루프에 안 들어간다.
// 7. 팀 모드일 때만 — 표식 테두리를 색 8 rectangle 로 다시 그려 지운다.
// 8. 팀 모드일 때만 — DGROUP 0x1d35 의 방향 표(부호 있는 바이트 (dx,dy) 쌍 넷)를 읽어,
//    표식 둘 × 방향 넷마다 표식에서 20픽셀 떨어진 자리에 6단계와 같은 모양의 상자를 그린다.
//
// ── 좌표가 상수가 아니다 ──────────────────────────────────────────────────────
//
// 이 함수 안의 좌표는 전부 DGROUP 0x1241 의 화면 크기 표에서 나온다. 표를 화면 모드
// (DGROUP 0x4D79) 로 보폭 4 로 색인해 W(x 최대)와 H(y 최대)를 읽는다. 모드 1 = 639,479
// (640x480), 모드 2 = 799,599 (800x600, 실측 설정), 모드 3 = 1023,767 (1024x768). 모드 0 은
// 0,0 이라 못 쓴다. 표에 항목이 넷뿐인 것은 0x1251 부터가 삼각형 정점 묶음이라 구조가
// 다르기 때문이다.
//
// 경기장은 오른쪽 38픽셀(상태 칸)을 뺀 나머지다. 모드 2 에서 경기장은 x 1..759, y 1..597.
// tools/check_claims.py 의 pos-within-arena 술어가 이 사각형을 쓴다.
//
// ── 전에 disasm/addr_0x084EB.md 의 uncertain 에 있던 것 중 이 포트가 정한 것 ──────
//
// · 0x86DB..0x8AD5 의 형태별 인자 산술 — 아래에 갈래마다 풀어 적었다.
// · 꼬리 루프 0x8D8E..0x8F92 가 표식마다 그리는 상자 넷 — 8단계다. 표식 중심(DGROUP
//   0x33DC/0x33DE)은 코드 어디에서도 안 쓰이고 골든에서 늘 0 이라, 나온 대로라면 상자들이
//   화면 원점 둘레에 그려진다. 못 만든 기능이거나 흔적이다.
// · 0x1261B, 0x0E128, 0x1284 가 하는 일 — 0x1284 는 borland_long 의 lshl(옮김). 0x1261B 와
//   0x0E128 은 1단계 경계로 인자만 기록하고 부르지 않으므로 "무슨 일을 하는지"는 이 작업이
//   정하지 않는다. 그 함수들을 옮길 때 정해진다.
//
// ── 씨앗 ────────────────────────────────────────────────────────────────────
//
// rand 는 5~8단계에서만 쓴다. 3단계의 0x0E128 이 5단계 전에 rand 를 쓸 수 있어서
// (goldens/round_setup 의 뽑기 수가 라운드마다 7..307 로 흔들리는 것의 일부), 정답표는
// 진입 시 씨앗(seedIn)과 0x086DB 시점 씨앗(seedAtStep5)을 둘 다 담고 포트에는 seedAtStep5
// 를 넣는다. 0x0E128 이 몇 번 뽑았는지는 정답표에 잰 사실로 적힌다. 포트가 판정받는 것은
// 5~8단계의 rand 사용이고, 그것은 정답표의 endSeed(retf 뒤 씨앗)로 붙든다.
//
// rand 는 다시 구현하지 않고 port/lib/rand.ts 의 randStep 을 씨앗을 인자로 흘리며 쓴다
// (round_setup.ts 와 같은 방식 — srand 의 16비트 자름을 피한다).
//
// 정답표: goldens/arena_layout_vectors_v1/  (다시 만들기: tools/capture_arena_layout.py)
// @원본 0x084EB
import { randStep } from "./rand.js";
import { lmul, sdiv, lshl, u32 } from "./borland_long.js";

const u16 = (v        )         => v & 0xffff;
const i16 = (v        )         => (v << 16) >> 16;
const sbyte = (v        )         => (v << 24) >> 24;

                                            
                                                                               

                       
                                                  
                            
                                      
                                  
                             
                                                 
                                      
                                     
                                                      
                                               

                              
                                           
               
                                                             
                             
                                                                 
                         
                                                       
                                                       
                                                                           
                   
                                                                      
                                                                                
                                                 
                   
 

                            
                              
                                   
                           
                     
                                
 

                              
                     
                                   
                  
 

// 6단계 받아들인 장애물과 8단계 표식 상자가 같은 모양이다. fill 과 다섯째 색만 다르다.
function drawBox(
  emit                        , x        , y        , w        , h        ,
  fill         , fifthColor        ,
)       {
  const R = (a     )       => { emit({ fn: "rectangle", args: a }); };
  const L = (a     )       => { emit({ fn: "line", args: a }); };
  const C = (c        )       => { emit({ fn: "setcolor", args: [u16(c)] }); };
  if (fill) {
    emit({ fn: "setfillstyle", args: [1, 9] });
    emit({ fn: "bar", args: [u16(x + 4), u16(y + 4), u16(x + w - 5), u16(y + h - 5)] });
  }
  C(7); R([u16(x), u16(y), u16(x + w), u16(y + h)]);
  C(0); R([u16(x + 1), u16(y + 1), u16(x + w), u16(y + h)]);
  C(7); R([u16(x + 3), u16(y + 3), u16(x + w - 3), u16(y + h - 3)]);
  C(0); R([u16(x + 4), u16(y + 4), u16(x + w - 3), u16(y + h - 3)]);
  C(fifthColor); R([u16(x + 4), u16(y + 4), u16(x + w - 4), u16(y + h - 4)]);
  C(0);
  L([u16(x + w - 3), u16(y + h - 3), u16(x + w), u16(y + h)]);
  L([u16(x + 1), u16(y + 1), u16(x + 2), u16(y + 2)]);
  L([u16(x + w - 3), u16(y + 3), u16(x + w), u16(y)]);
  L([u16(x + 3), u16(y + h - 3), u16(x), u16(y + h)]);
}

export function runArenaLayout(dg            , script             )              {
  const rdW = (off        )         => dg[off & 0xffff] | (dg[(off + 1) & 0xffff] << 8);
  const rdB = (off        )         => dg[off & 0xffff];
  const bp6 = (v        )       => {          // [bp-6] 쓰기
    if (script.frameBp === undefined) return;
    const a = (script.frameBp - 6) & 0xffff; dg[a] = v & 0xff; dg[(a + 1) & 0xffff] = (v >> 8) & 0xff;
  };

  const mode = sbyte(rdB(0x4d79));                 // cwde 로 부호 확장한 화면 모드
  const geomBx = u16(mode << 2);
  const W = rdW(u16(0x1241 + geomBx));
  const H = rdW(u16(0x1243 + geomBx));
  const team = rdB(0x4d65);
  const tankCount = rdB(0x4d73);
  const m = i16(u16(u16(mode << 1)) - 1);          // 0x4D79*2 - 1 (모드 2 → 3)
  const modeB = i16(u16(mode));                    // add ax,N 에 쓰는 cwde 결과

  let s = u32(script.seed);
  const draw = ()         => { const r = randStep(s); s = r.next; return r.result; };

  const calls              = [];
  const live = script.live;
  const emit = (c           )       => { calls.push(c); live?.exec(c); };
  const sfs = (pat        , col        )       => {
    emit({ fn: "setfillstyle", args: [u16(pat), u16(col)] });
  };
  const bar = (a     )       => { emit({ fn: "bar", args: a }); };
  const sc = (col        )       => { emit({ fn: "setcolor", args: [u16(col)] }); };
  const rect = (a     )       => { emit({ fn: "rectangle", args: a }); };

  // 원본 0x08F99 는 인자를 스택에서 제자리 고친다 (0x08FA7 y1-=10, 0x08FAB x2+=10,
  // 0x08FAF y2+=10; x1 만 di 로 복사해 안 건드린다). 포트는 이것을 재현하지 않는다 —
  // 부르는 쪽이 `add sp,8` 로 인자를 걷어내고 다시 안 읽기 때문이다. 정답표는 캡처가
  // post 로그포인트에서 되돌린 값을 담으므로, 포트가 내는 인자와 그대로 맞는다.
  let rcIdx = 0;
  const rectClear = (a     )         => {
    if (live) { const ret = live.isRectangleClear(a) & 0xffff; calls.push({ fn: "isRectangleClear", args: a, ret }); return ret; }
    if (rcIdx >= script.rectClearReturns.length) {
      throw new Error(
        "runArenaLayout: rectClearReturns 소진 — 원본에 물은 것보다 0x08F99 호출이 많다",
      );
    }
    const ret = script.rectClearReturns[rcIdx++] & 0xffff;
    calls.push({ fn: "isRectangleClear", args: a, ret });
    return ret;
  };
  let prIdx = 0;
  const probeAt = (a        )         => {
    if (live) { const ret = live.probe(a) & 0xff; calls.push({ fn: "probe", args: a, ret }); return ret; }
    if (prIdx >= script.probeReturns.length) {
      throw new Error(
        "runArenaLayout: probeReturns 소진 — 원본에 물은 것보다 0x046CA 호출이 많다",
      );
    }
    const ret = script.probeReturns[prIdx++] & 0xff;
    calls.push({ fn: "probe", args: a, ret });
    return ret;
  };

  // ── 1단계 — 경기장과 상태 칸, 테두리 셋 ────────────────────────────────────
  sfs(1, 8);
  bar([1, 1, u16(W - 0x28), u16(H - 2)]);            // 경기장 (W-40, H-2)
  sfs(1, 8);
  bar([u16(W - 0x26), 1, u16(W), u16(H - 2)]);       // 오른쪽 상태 칸 (W-38..W)
  sc(7);
  rect([0, 0, u16(W - 0x27), u16(H)]);               // 경기장 바깥 테두리 (W-39)
  sc(0);
  rect([1, 1, u16(W - 0x27), u16(H - 1)]);           // 경기장 안쪽 테두리
  sc(7);
  rect([u16(W - 0x26), 0, u16(W), u16(H)]);          // 상태 칸 테두리

  // ── 2단계 — 참가자마다 상태 칸 그리기 ────────────────────────────────────
  for (let k = 0; sbyte(k) < sbyte(tankCount); k++) {
    emit({ fn: "statusPanel", args: [0, u16(k)] });
  }

  // ── 3단계 — 탱크 이동과 그리기 ──────────────────────────────────────────
  emit({ fn: "tankMove", args: [1] });

  // ── 4단계 — 팀 모드: 표식 그리기 준비 ──────────────────────────────────
  if (team !== 0) {
    emit({ fn: "markers", args: [1] });
    sc(9);
    for (let mk = 1; sbyte(mk) <= 2; mk++) {
      const bx = u16(sbyte(mk) << 5);
      const cx = rdW(u16(0x33dc + bx));
      const cy = rdW(u16(0x33de + bx));
      rect([u16(cx - 5), u16(cy - 5), u16(cx + 5), u16(cy + 5)]);
    }
  }

  // ── 5단계 — 배치 형태와 장애물 개수 ────────────────────────────────────
  if (live) s = u32(live.readSeed());
  let shape = u16(sdiv(lmul(draw(), 7), 0x8000));
  if (i16(shape) > 5) {
    shape = u16(sdiv(u32(draw() * 2), 0x8000) + 4);
  }
  let count = 0;
  if (shape === 1) count = u16(sdiv(i16(u16(m * 0x19)), 2));   // m*25/2
  else if (shape === 2) count = u16(sdiv(i16(u16(m * 0x32)), 2));   // m*50/2
  else if (shape === 3) count = u16(sdiv(i16(u16(m * 0x28)), 2));   // m*40/2
  else if (shape === 4) count = u16(sdiv(i16(u16(m * 0x0a)), 2));   // m*10/2
  else if (shape === 5) {
    const k4 = sdiv(lshl(u32(draw()), 2), 0x8000);              // rand()*4/32768, 0..3
    count = u16(sdiv(i16(u16(k4 * m)), 2) + 3);
  }

  // 화면 크기 표에서 나오는 격자 보폭 두 개.
  const gridX = sdiv(i16(u16(W - 50)), 20);                    // (W-50)/20
  const gridY = sdiv(i16(u16(H + 1)), 20);                     // (H+1)/20

  // ── 6단계 — 장애물마다 ────────────────────────────────────────────────
  for (let ob = 0; shape !== 0 && i16(sbyte(ob)) < i16(count); ob++) {
    let ox = 0, oy = 0, ow = 0, oh = 0;

    if (shape === 1 || shape === 3 || shape === 5) {
      // 갈래 A
      ox = u16(u16(sdiv(lmul(gridX, draw()), 0x8000) * 20) + 10);
      ow = u16(u16(sdiv(lmul(i16(u16(modeB + 6)), draw()), 0x8000) + 2) * 10); bp6(ow);   // 0x0885D
      oy = u16(u16(sdiv(lmul(gridY, draw()), 0x8000) * 20) + 10);
      oh = u16(u16(sdiv(lmul(i16(u16(modeB + 6)), draw()), 0x8000) + 2) * 10);
      if (shape === 5 || shape === 1) {
        ow = i16(u16(modeB + 9)); bp6(ow);                                   // 0x088E0
        oh = i16(u16(modeB + 9));
      }
    } else {
      // 갈래 B (형태 2, 4)
      const splitB = sdiv(u32(draw() * 2), 0x8000);            // 0 또는 1
      if (splitB !== 0) {
        ox = u16(u16(sdiv(lmul(gridX, draw()), 0x8000) * 20) + 10);
        ow = 0x0a; bp6(ow);                                    // 상수, 뽑기 없음 (0x0894E)
        oy = u16(u16(sdiv(lmul(gridY, draw()), 0x8000) * 20) + 10);
        oh = u16(u16(sdiv(lmul(i16(u16(modeB + 5)), draw()), 0x8000) + 2) * 10);
        if (shape === 4) {
          oh = u16(oh + u16(u16(sdiv(lmul(draw(), 0x0a), 0x8000) * 10) + 0x3c));
        }
      } else {
        ox = u16(u16(sdiv(lmul(gridX, draw()), 0x8000) * 20) + 10);
        ow = u16(u16(sdiv(lmul(i16(u16(modeB + 5)), draw()), 0x8000) + 2) * 10); bp6(ow);   // 0x08A62
        oy = u16(u16(sdiv(lmul(gridY, draw()), 0x8000) * 20) + 10);
        oh = 0x0a;                                             // 상수, 뽑기 없음
        if (shape === 4) {
          ow = u16(ow + u16(u16(sdiv(lmul(i16(u16(modeB + 9)), draw()), 0x8000) * 10) + 0x3c)); bp6(ow);   // 0x08ADA
        }
      }
    }

    // 받아들일지 검사
    let reject = i16(rectClear([u16(ox), u16(oy), u16(ox + ow), u16(oy + oh)])) !== -1;
    if (shape === 3) {
      for (let cx = u16(ox + 0x0a); i16(u16(u16(ox + ow) - 10)) >= i16(cx); cx = u16(cx + 0x0a)) {
        const r = probeAt([u16(cx), u16(oy + 0x0a), u16(cx), u16(oy + oh - 10), 1, 8, 0, 0]);
        if ((r & 0xff) !== 0xff) reject = true;
      }
    }
    if (reject) continue;

    drawBox(emit, ox, oy, ow, oh, true, 8);
  }

  // ── 7단계 — 팀 모드: 표식 테두리 지우기 (색 8) ──────────────────────────
  if (team === 0) { live?.writeSeed(s); return { calls, endSeed: s }; }
  sc(8);
  for (let mk = 1; sbyte(mk) <= 2; mk++) {
    const bx = u16(sbyte(mk) << 5);
    const cx = rdW(u16(0x33dc + bx));
    const cy = rdW(u16(0x33de + bx));
    rect([u16(cx - 5), u16(cy - 5), u16(cx + 5), u16(cy + 5)]);
  }

  // ── 8단계 — 팀 모드: 표식마다 네 방향 상자 ──────────────────────────────
  for (let mk = 1; sbyte(mk) <= 2; mk++) {
    const mbx = u16(sbyte(mk) << 5);
    const mcx = rdW(u16(0x33dc + mbx));
    const mcy = rdW(u16(0x33de + mbx));
    for (let dir = 0; i16(dir) < 4; dir++) {
      const dx = sbyte(rdB(u16(0x1d35 + dir * 2)));
      const dy = sbyte(rdB(u16(0x1d35 + dir * 2 + 1)));
      const ox = u16(mcx + u16(dx * 20) - 5);
      const oy = u16(mcy + u16(dy * 20) - 5);
      const ow = 0x0a, oh = 0x0a; bp6(ow);                   // 0x08DE8
      if (i16(rectClear([u16(ox + 5), u16(oy + 5), u16(ox + ow - 5), u16(oy + oh - 5)])) !== -1) {
        continue;
      }
      drawBox(emit, ox, oy, ow, oh, false, 9);
    }
  }

  live?.writeSeed(s);
  return { calls, endSeed: s };
}
