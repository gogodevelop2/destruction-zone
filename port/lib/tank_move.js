// 탱크 이동과 그리기 0x0E128 을 옮긴 것이다. 함수 전체는 runTankMove (아래) 이고,
// stepTank 는 그 가운데 위치·각 적분만 떼어 낸 것이다 (tank_move.test.ts 가 프레임 골든에 댄다).
//
// 이 함수는 새 위치의 삼각형 세 변을 선 탐침 0x046CA 로 훑어 **화면의 픽셀 색**을 읽고 이동을
// 받아들일지 정한다. 그래서 화면(BGI)은 출력이 아니라 이 함수의 입력이다.
//
// 원본: disasm/addr_0x0E128.md. 각도 단위는 1/50 도이고 위치는 1/50 픽셀이다.
// 정답표: goldens/tank_move_vectors_v1/ (다시 만들기: tools/capture_tank_move.py)
// @원본 0x0E128
import { sine, cosine } from "./trig.js";
import { sdiv, lmul, lshl, i32 } from "./borland_long.js";
import { randStep } from "./rand.js";

const i16 = (v        )         => (v << 16) >> 16;
/** 원본의 `idiv` — 0 쪽으로 자른다. */
const idiv = (a        , b        )         => Math.trunc(a / b);

                         
                                            
                                   
                                         
                                                      
                                        
                                                
                                                
                                        
 

                                                                      

/**
 * 원본 0x0E326..0x0E43F. 부딪힘 판정 전의 새 위치와 각을 낸다.
 *
 * 16비트 자르기가 세 군데 있다. 전부 `imul` 이 만든 32비트 곱을 곧바로 16비트로
 * 줄이는 자리다 — 0x0E392 는 `push ax` 로 하위 워드만 남기고, 0x0E3A1 과 0x0E421 은
 * `cwd` 가 DX 를 AX 의 부호로 덮는다. 이 자르기를 빼면 큰 각·큰 속도에서 갈린다.
 */
export function stepTank(t        )          {
  let { posX, posY, angle } = t;

  // 0x0E361 — 전진·후진 명령이 있을 때만 위치를 움직인다
  if (t.moveAxis !== 0) {
    // 0x0E36B..0x0E3AC  x 축: 코사인
    const cx = i16(i16(cosine(angle) * t.moveAxis) * t.speed);
    posX = (posX + idiv(cx, t.frameDivisor)) | 0;
    // 0x0E3AD..0x0E3EE  y 축: 사인
    const cy = i16(i16(sine(angle) * t.moveAxis) * t.speed);
    posY = (posY + idiv(cy, t.frameDivisor)) | 0;
  }

  // 0x0E3EF — 회전 명령이 있을 때만 각을 돌린다
  if (t.rotateAxis !== 0) {
    const r = i16(i16(t.rotateAxis * t.turnRate) * 1100);
    angle = i16(angle + idiv(r, t.frameDivisor));   // 0x0E426 은 16비트 덧셈이다
    if (angle > 18000) angle -= 18000;              // 0x0E429
    if (angle < 0) angle += 18000;                  // 0x0E435
  }

  return { posX, posY, angle };
}

// ══ 함수 전체 — runTankMove ══════════════════════════════════════════════════
//
// 원본 0x0E128. 탱크 배열을 도는 루프 하나다. 부르는 곳은 셋 — 경기장 배치 3단계
// (0x0865E, 인자 1), 게임 루프(0x0AC6C, 인자 0), 물체 갱신의 파괴 경로(0x1001C, 인자 1).
// 인자 [bp+6] 이 0 이 아니면 파괴된 탱크(+0x02)도 처리한다.
//
// 탱크 하나에 대해:
//   1. 0x0AEB8 키보드 표본을 한 번 읽는다 (탱크마다, 프레임마다가 아니다).
//   2. 난수 1번으로 무기 에너지 +0x26 을 1 올린다 (100 에서 멈춘다).
//      rand() * (0x4D63*6/7 / (+0x3E*2+3)) / 32768 이 0 일 때만. 0x4D63*6 은 16비트로 잘린다.
//   3. +0x3D 가 서 있으면 난수를 더 써서 실드 +0x22 를 1 올리고(400 에서 멈춘다) +0x81 을
//      올린다. 그래서 "탱크당 난수 정확히 1번"(analysis/tank_movement.md)은 +0x3D 가 0 일
//      때만 참이다.
//      +0x3A 는 무기 에너지 표시 십자를, +0x40 은 터렛 선을 켠다 (10·11·12).
//   4. 명령 바이트 +0x04(전진)·+0x05(회전)·+0x06(터렛)이 모두 0 이고 인자도 0 이면 5~9 를
//      건너뛰고 11(물렸다)로 간다 (0x0EB1C).
//   5. 새 위치와 차체 각을 적분한다 (stepTank 와 같은 식). 터렛 각 +0x13 은 +0x06 이 ±1 이면
//      돌리고, 2 면 0 으로 되돌리고 +0x06 을 지운다.
//   6. 새 차체 각으로 삼각형 세 꼭짓점을 돌려 만들고(0x1251 표, 6바이트씩), 세 변을
//      선 탐침(0x046CA, count 2, 색 8·자기 색·0)으로 차례로 훑는다. 막힌 변이 나오면 멈춘다.
// 탐침이 낸 색으로 가른다 (0x0E718..0x0EB1B):
//   7. 꼭짓점 좌표가 하나라도 음수면 색 7 로 본다.
//      0xFF(빈 곳)면 받아들인다. 7·0·[0x127C]·[0x127D] 면 물린다 ([bp-0x1A] = 1).
//   8. 15(흰색 — 다른 탱크의 테두리)면: 번호가 더 큰 살아 있는 탱크 가운데 가까운 것을
//      0x0F256 으로 다시 그리고, 색 15 를 찾는 탐침(count 3, 8·15·자기 색)을 세 변에 다시
//      해서 걸리면 물린다.
//      ⚠ "가까운가" 는 x·y 차이가 13000(1/50 픽셀, 260 픽셀) 보다 작은가다. 차이가 음수면
//      원본은 절댓값 대신 -(그 탱크) - (이 탱크) 를 계산한다 (0x0E7D7·0x0E870 의 neg 가 한쪽만
//      뒤집는다). 좌표가 양수인 한 그 값은 늘 음수라 조건이 늘 참이다. 그대로 옮겼다.
//   9. 그 밖의 색이면 0x127E 표로 그 색의 주인 탱크를 찾는다. 주인이 살아 있으면 주인의
//      삼각형을 흰색(15)으로 덧그리고(moveto 셋째 꼭짓점, lineto 셋), 세 변을 색 15 가
//      나올 때까지 다시 탐침해 걸리면 물리고, 주인을 0x0F256 으로 다시 그린다.
// 그 뒤 (0x0EB1C..0x0F241):
//  10. 받아들였으면 옛 삼각형을 바닥색 8 로 지우고(안 바뀐 변은 건너뛴다) 새 삼각형을 그리고,
//      옛 중심 십자를 지운다. 회전 명령이나 인자가 있으면 꼭짓점과 각 +0x11 을, 전진 명령이
//      있으면 위치를 되쓴다. 각은 언제나 쓰는 것이 아니다.
//  11. 물렸으면 옛 중심 픽셀을 읽어 에너지 십자를 그리거나 지우고, 탱크를 제자리에 네 번
//      다시 그린다. 레코드의 위치·각은 안 바뀐다.
//  12. 터렛이 있으면 옛 터렛 선을 지우고 (터렛 각/2 + 차체 각/2) % 9000 * 2 로 새로 긋는다.

                               
                                                                                
                                                       
                                                                                     
                                                                                      
                                                                                      
                                                                                      
                                                                                
                                                                                      
                                                                                      
 

const u16 = (v        )         => v & 0xffff;
const sbyte = (v        )         => (v << 24) >> 24;
const sd = (a        , b        )         => i32(sdiv(a, b));
/** 16비트 cwd; idiv. 원본이 INT 0 으로 죽는 자리에서는 멈춘다. */
function idiv16(a        , b        )                           {
  const q = Math.trunc(i16(a) / i16(b));
  if (i16(b) === 0 || q !== i16(q)) throw new Error(`idiv16: ${i16(a)} / ${i16(b)} — 원본은 INT 0`);
  return { q, r: i16(a) % i16(b) };
}
const TANK = 0x43fc, STRIDE = 0x176;

// frameBp — 이 호출의 BP. 이 게임은 스택이 DGROUP 안(SS=DS)이라 지역 변수가 DGROUP 바이트다. 다른 함수(오토파일럿
// [bp-0x2a])가 초기화하지 않고 읽는 자리와 겹치는 지역만 원본처럼 거기 쓴다 — [bp-6](차체 모양)과 [bp-0x22]·[bp-0x2a]
// (옛 꼭짓점 x·y 배열). 원본에서 잰 BP: 게임 루프 0xFFE0, 경기장 배치 0xFFBE, 물체 갱신 0xFF9C (devlog 114·120).
// 없으면 안 쓴다(정답표 시험은 하니스 스택이라 대조 밖이다).
export function runTankMove(host              , dg            , arg        , frameBp         )       {
  const stk = (off        , v        )       => {
    if (frameBp === undefined) return;
    const a = (frameBp - off) & 0xffff; dg[a] = v & 0xff; dg[(a + 1) & 0xffff] = (v >> 8) & 0xff;
  };
  const rd8 = (a        ) => dg[u16(a)];
  const rd16 = (a        ) => dg[u16(a)] | (dg[u16(a + 1)] << 8);
  const rd32 = (a        ) => (rd16(a) | (rd16(a + 2) << 16)) | 0;
  const wr8 = (a        , v        ) => { dg[u16(a)] = v & 0xff; };
  const wr16 = (a        , v        ) => { wr8(a, v); wr8(a + 1, v >> 8); };
  const draw = ()         => {
    const r = randStep(rd32(0x3268) >>> 0);
    wr16(0x3268, r.next); wr16(0x326a, r.next >>> 16);
    return r.result;
  };
  /** rand() * q / 32768 의 하위 워드. 나누는 수 0x8000 은 rand 를 부를 때 쌓은 것이 남은 것이다. */
  const drawTimes = (q        ) => u16(sd(lmul(draw(), q), 0x8000));
  const rate = () => i16(rd16(0x4d63));
  const argSet = sbyte(arg) !== 0;

  for (let di = 0; di < sbyte(rd8(0x4d73)); di++) {
    const b = u16(TANK + i16(di * STRIDE));
    if (rd8(b + 0x02) !== 0 && !argSet) continue;                         // 0x0E13E..0x0E14D
    host.sampleKeyboard();                                                // 0x0E151
    const oldX50 = i16(sd(rd32(b + 0x09), 50));                           // [bp-0x40]
    const oldY50 = i16(sd(rd32(b + 0x0d), 50));                           // [bp-0x42]
    let ang = i16(rd16(b + 0x11));                                        // [bp-0x18]

    // 2 — 무기 에너지 (0x0E1A4..0x0E212). rand 가 먼저 불린다.
    {
      const r = draw();
      const q = idiv16(idiv16(i16(rate() * 6), 7).q, i16(sbyte(rd8(b + 0x3e)) * 2 + 3)).q;
      if (u16(sd(lmul(r, q), 0x8000)) === 0) {
        wr8(b + 0x26, rd8(b + 0x26) + 1);
        if (sbyte(rd8(b + 0x26)) > 100) wr8(b + 0x26, 100);
      }
    }
    // 3 — 실드 (0x0E217..0x0E2E3)
    if (rd8(b + 0x3d) !== 0) {
      const q = idiv16(rate(), 6).q;
      const go = drawTimes(q) === 0 || drawTimes(q) === 0;              // 둘째는 첫째가 0 이 아닐 때만
      if (go && rd8(b + 0x81) < 0xff) {
        if (u16(sd(lshl(draw(), 2), 0x8000)) !== 0) wr8(b + 0x81, rd8(b + 0x81) + 1);
        wr16(b + 0x22, rd16(b + 0x22) + 1);
        if (i16(rd16(b + 0x22)) > 400) wr16(b + 0x22, 400);
      }
    }

    // 4 — 할 일이 없으면 5~9 를 건너뛰고 "물렸다" 로 간다 (0x0E2E9..0x0E323 → 0x0EB1C)
    let blocked = 1;                                                      // [bp-0x1A]
    let px = 0, py = 0;                                    // [bp-0x12] [bp-0x16] 새 위치 (32비트)
    let vx           = [], vy           = [];              // [bp-0xA] [bp-0xE] 새 꼭짓점 오프셋, 바이트
    let X           = [], Y           = [];                // [bp-0x32] [bp-0x3A] 새 꼭짓점 좌표
    const colour = rd8(0x126f + di);
    const idle = rd8(b + 0x06) === 0 && rd8(b + 0x04) === 0 && rd8(b + 0x05) === 0 && sbyte(arg) === 0;
    moving: {
      if (idle) break moving;

      // 5 — 새 위치·각 (0x0E326..0x0E52C)
      px = rd32(b + 0x09); py = rd32(b + 0x0d);
      blocked = 0;
      const move = sbyte(rd8(b + 0x04));
      if (move !== 0) {
        const a = i16(rd16(b + 0x11)), speed = i16(rd16(b + 0x1d));
        px = i32(px + idiv16(i16(i16(cosine(a) * move) * speed), rate()).q);
        py = i32(py + idiv16(i16(i16(sine(a) * move) * speed), rate()).q);
      }
      const turnRate = i16(rd16(b + 0x1f));
      const rot = sbyte(rd8(b + 0x05));
      if (rot !== 0) {
        ang = i16(ang + idiv16(i16(i16(rot * turnRate) * 1100), rate()).q);
        if (ang > 18000) ang = i16(ang - 18000);
        if (ang < 0) ang = i16(ang + 18000);
      }
      const tur = sbyte(rd8(b + 0x06));
      if (Math.abs(tur) === 1) {                                            // 0x0E449..0x0E473
        const d = idiv16(i16(i16(tur * turnRate) * 2000), rate()).q;
        wr16(b + 0x13, idiv16(i16(rd16(b + 0x13)) + d, 18000).r);
        if (i16(rd16(b + 0x13)) > 18000) wr16(b + 0x13, rd16(b + 0x13) - 18000);
        if (i16(rd16(b + 0x13)) < 0) wr16(b + 0x13, rd16(b + 0x13) + 18000);
      }
      if (rd8(b + 0x06) === 2) { wr16(b + 0x13, 0); wr8(b + 0x06, 0); }  // 0x0E50D..0x0E52C

      // 6 — 삼각형 (0x0E531..0x0E69D). 곱은 idiv 앞의 cwd 가 16비트로 자른다.
      const row = sbyte(rd8(b + 0x01));
      stk(6, row);                                                          // 0x0E53F [bp-6] (cwde)
      vx = []; vy = [];
      for (let k = 0; k <= 2; k++) {
        const idx = u16(i16(row * 6) + k * 2);
        const t1 = sbyte(rd8(0x1251 + idx)), t2 = sbyte(rd8(0x1252 + idx));
        const f = (t        , v        ) => idiv16(i16(t * v), 1000).q;
        vx.push((f(t1, cosine(ang)) - f(t2, sine(ang))) & 0xff);
        vy.push((f(t1, sine(ang)) + f(t2, cosine(ang))) & 0xff);
      }
      vx.push(vx[0]); vy.push(vy[0]);                                       // 0x0E61E..0x0E627
      X = []; Y = [];
      for (let k = 0; k <= 2; k++) {
        X.push(i16(sd(px, 50) + sbyte(vx[k])));
        Y.push(i16(sd(py, 50) + sbyte(vy[k])));
      }
      X.push(X[0]); Y.push(Y[0]);
      let hit = 0xff;                                                       // [bp-0x19]
      for (let k = 0; k <= 2 && hit === 0xff; k++) {                        // 0x0E6A0..0x0E715
        hit = host.probe(X[k], Y[k], X[k + 1], Y[k + 1], 2, 8, colour, 0) & 0xff;
      }

      // 7 (0x0E718..0x0E76B)
      if (X[0] < 0 || Y[0] < 0 || X[1] < 0 || Y[1] < 0 || X[2] < 0 || Y[2] < 0) hit = 7;
      const probeUntil = (count        , c1        , c2        , c3        , stop                        ) => {
        let h = 0;
        for (let k = 0; k <= 2; k++) { h = host.probe(X[k], Y[k], X[k + 1], Y[k + 1], count, c1, c2, c3) & 0xff; if (stop(h)) break; }
        return h;
      };
      if (hit === 0xff) {
        // 받아들인다
      } else if (hit === 7 || hit === 0 || hit === rd8(0x127c) || hit === rd8(0x127d)) {
        blocked = 1;
      } else if (hit === 0x0f) {
        // 8 (0x0E777..0x0E95F)
        for (let j = di + 1; sbyte(rd8(0x4d73)) > j; j++) {
          const bj = u16(TANK + i16(j * STRIDE));
          if (rd8(bj + 0x02) !== 0) continue;
          const near = (off        ) => {
            const pj = rd32(bj + off), pi = rd32(b + off);
            const d = i32(pj - pi);
            return (d < 0 ? i32(-pj - pi) : d) < 13000;                     // 위 ⚠
          };
          if (near(0x09) && near(0x0d)) host.drawTank(j & 0xff, 0);
        }
        if (probeUntil(3, 8, 0x0f, colour, (h) => h !== 0xff) !== 0xff) blocked = 1;
      } else {
        // 9 (0x0E962..0x0EB1B)
        const owner = sbyte(rd8(0x127e + sbyte(hit)));                     // [bp-0x43]
        const ob = u16(TANK + i16(owner * STRIDE));
        if (sbyte(rd8(ob + 0x02)) === 0) {
          host.setcolor(15);
          const ox = () => i16(sd(rd32(ob + 0x09), 50)), oy = () => i16(sd(rd32(ob + 0x0d), 50));
          host.moveTo(i16(ox() + sbyte(rd8(ob + 0x43))), i16(oy() + sbyte(rd8(ob + 0x47))));
          for (let k = 0; k <= 2; k++) {
            host.lineTo(i16(ox() + sbyte(rd8(ob + 0x41 + k))), i16(oy() + sbyte(rd8(ob + 0x45 + k))));
          }
          if (probeUntil(2, 8, colour, 0, (h) => h === 0x0f) === 0x0f) blocked = 1;
          host.drawTank(owner & 0xff, 0);
        }
      }

    }

    const bodyColour = () => (rd8(b + 0x02) !== 0 ? 8 : colour);
    const cross = (x        , y        ) => {
      host.line(i16(x - 1), y, i16(x + 1), y);
      host.line(x, i16(y - 1), x, i16(y + 1));
    };
    // 고른 무기(재고 칸 +0x49[+0x34])의 발사 에너지 비용(카탈로그 +0x35, 기저 0x5DC 라 0x611 +
    // 품목*0x3D — analysis/shop_items.md)이 무기 에너지 +0x26 보다 크고 살아 있으면
    const shortOfEnergy = () =>
      sbyte(rd8(0x611 + i16(sbyte(rd8(b + 0x49 + sbyte(rd8(b + 0x34)))) * 0x3d))) > sbyte(rd8(b + 0x26)) &&
      sbyte(rd8(b + 0x02)) === 0;

    if (blocked === 0) {
      // 10 — 받아들였다 (0x0EB27..0x0EEE9). 옛 삼각형을 바닥색으로 지우되 안 바뀐 변은 건너뛴다.
      const OX           = [], OY           = [];                          // [bp-0x22] [bp-0x2A]
      for (let k = 0; k <= 2; k++) {
        OX.push(i16(oldX50 + sbyte(rd8(b + 0x41 + k))));
        OY.push(i16(oldY50 + sbyte(rd8(b + 0x45 + k))));
        stk(0x22 - 2 * k, OX[k]); stk(0x2a - 2 * k, OY[k]);                 // 0x0EB4C·0x0EB70
      }
      OX.push(OX[0]); OY.push(OY[0]);
      const same = [0, 1, 2].map((k) =>                                     // [bp-0x3D]
        OX[k] === X[k] && OY[k] === Y[k] && OX[k + 1] === X[k + 1] && OY[k + 1] === Y[k + 1]);
      host.setcolor(8);
      host.moveTo(OX[0], OY[0]);
      for (let k = 1; k <= 3; k++) {
        if (same[k - 1]) host.moveTo(OX[k], OY[k]); else host.lineTo(OX[k], OY[k]);
      }
      host.setcolor(bodyColour());
      host.moveTo(X[2], Y[2]);
      for (let k = 0; k <= 2; k++) host.lineTo(X[k], Y[k]);
      host.setcolor(8);
      cross(oldX50, oldY50);
      if (rd8(b + 0x3a) !== 0 && shortOfEnergy()) {                       // 0x0ED24..0x0EE3E
        host.setcolor(3);
        cross(i16(sd(px, 50)), i16(sd(py, 50)));
      }
      if (rd8(b + 0x05) !== 0 || sbyte(arg) !== 0) {                       // 0x0EE41..0x0EEA7
        for (let k = 0; k <= 3; k++) { wr8(b + 0x41 + k, vx[k]); wr8(b + 0x45 + k, vy[k]); }
        wr16(b + 0x11, ang);
      }
      if (rd8(b + 0x04) !== 0) {                                           // 0x0EEAB..0x0EEE5
        wr16(b + 0x09, px); wr16(b + 0x0b, px >>> 16);
        wr16(b + 0x0d, py); wr16(b + 0x0f, py >>> 16);
      }
    } else {
      // 11 — 물렸다 (0x0EEEC..0x0F0AB). 옛 중심 픽셀을 읽어 에너지 표시 십자를 그리거나 지우고,
      // 탱크를 제자리에 네 번 다시 그린다.
      if (rd8(b + 0x3a) !== 0) {
        if (shortOfEnergy()) {
          if (host.getPixel(oldX50, oldY50) !== 3 || rd8(b + 0x40) !== 0) { host.setcolor(3); cross(oldX50, oldY50); }
        } else if (host.getPixel(oldX50, oldY50) === 3 || rd8(b + 0x40) !== 0) {
          host.setcolor(8); cross(oldX50, oldY50);
        }
      }
      for (let m = 0; m < 4; m++) {
        host.moveTo(i16(oldX50 + sbyte(rd8(b + 0x43))), i16(oldY50 + sbyte(rd8(b + 0x47))));
        host.setcolor(bodyColour());
        for (let k = 0; k <= 2; k++) {
          host.lineTo(i16(oldX50 + sbyte(rd8(b + 0x41 + k))), i16(oldY50 + sbyte(rd8(b + 0x45 + k))));
        }
      }
    }

    // 12 — 터렛 선 (0x0F0B0..0x0F241). 각은 (터렛 각/2 + 차체 각/2) % 9000 * 2 이다.
    //   차체 각은 [bp-0x18] 이라, 물린 경우에는 레코드에 안 쓴 새 각이 여기서만 쓰인다.
    if (rd8(b + 0x40) !== 0 && sbyte(rd8(b + 0x02)) === 0) {
      const turretLine = () => host.line(i16(rd16(b + 0x15)), i16(rd16(b + 0x17)), i16(rd16(b + 0x19)), i16(rd16(b + 0x1b)));
      host.setcolor(8);
      turretLine();
      const a = i16(idiv16(i16(idiv16(rd16(b + 0x13), 2).q + idiv16(ang, 2).q), 9000).r << 1);
      wr16(b + 0x15, sd(rd32(b + 0x09), 50));
      wr16(b + 0x17, sd(rd32(b + 0x0d), 50));
      wr16(b + 0x19, rd16(b + 0x15) + idiv16(cosine(a), 250).q);
      wr16(b + 0x1b, rd16(b + 0x17) + idiv16(sine(a), 250).q);
      host.setcolor(colour);
      turretLine();
    }
  }
}
