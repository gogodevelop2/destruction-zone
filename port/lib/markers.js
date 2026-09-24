// 원본 DZONE.EXE 의 회전 표시자 갱신·다시 그리기 0x1229C 재구현.
//
// 뜻은 analysis/markers.md 에, 바이트 근거는 disasm/addr_0x1229C.md 에 있다.
//
// 표시자는 두 편의 남은 에너지를 보여 주는 삼각형 둘이다. 도는 빠르기가 곧 점수이고,
// 맞을 때마다 진 쪽의 에너지가 이긴 쪽으로 옮겨 간다. 여기서는 그와 별개로 천천히
// 새어 나가는 몫을 처리하고, 하나가 음수가 되면 라운드가 끝난다.
//
// ⚠ 배포된 설정에서는 0x4D65 도 0x4D62 도 0 이라 이 함수 자체가 안 불린다. 지금 잡아
//   둔 골든이 안 들어가는 모드다.
// @원본 0x1229C

import { sine, cosine } from "./trig.js";
import { rand } from "./rand.js";
import { lmul, sdiv, i32 } from "./borland_long.js";

export const MARKER_BASE = 0x33dc, MARKER_STRIDE = 0x20;
export const SHAPE = 0x1275;          // 삼각형 정점 표. 탱크가 쓰는 것과 같은 표의 6번 묶음.
export const MARKER_COLOUR = 0x127b;  // 표시자별 팔레트 슬롯
export const DECAY_SELECT = 0x4d62, FRAME_DIVISOR = 0x4d63, ROUND_OVER = 0x4d66;
export const ERASE_COLOUR = 8;        // 아레나 바닥색. 이 색으로 다시 그리는 것이 지우기다.

const i16 = (v        )         => (v << 16) >> 16;

/** 원본이 BGI 에 맡기는 세 가지. 색을 정하고, 붓을 옮기고, 선을 긋는다. */
                      
                                  
                                     
                                     
 

/**
 * 표시자 둘을 한 걸음 돌리고 다시 그린다 (0x1229C).
 *
 * `noErase` 가 0 이면 먼저 지난번 삼각형을 바닥색으로 덧그려 지운다. 0 이 아니면 그
 * 단계를 건너뛰고 바로 그린다.
 */
export function updateMarkers(ds          , noErase        , pen     )       {
  const divisor = ds.getInt16(FRAME_DIVISOR, true);

  for (let i = 1; i <= 2; i++) {
    const m = MARKER_BASE + (i << 5);

    // ⚠ 곱셈이 16비트로 잘린다. `imul dx` 가 32비트 곱을 DX:AX 에 두는데 바로 다음
    //   `cwd` 가 DX 를 AX 의 부호로 덮는다. 그래서 도는 빠르기가 546 쯤을 넘으면 넘친다.
    const spin = i16(ds.getInt16(m + 0x16, true) * 60);
    const step = i16(i16(Math.trunc(spin / divisor)) * 3);
    const angle = i16(ds.getInt16(m + 0x14, true) + step) % 18000;
    ds.setInt16(m + 0x14, angle, true);

    // 정점 셋을 각도만큼 중심 둘레로 돌린다.
    const cx = ds.getInt16(m, true), cy = ds.getInt16(m + 2, true);
    const vx           = [], vy           = [];
    for (let k = 0; k < 3; k++) {
      const X = ds.getInt8(SHAPE + k * 2), Y = ds.getInt8(SHAPE + k * 2 + 1);
      const xc = Math.trunc(i16(X * cosine(angle)) / 1000);
      const ys = Math.trunc(i16(Y * sine(angle)) / 1000);
      const xs = Math.trunc(i16(X * sine(angle)) / 1000);
      const yc = Math.trunc(i16(Y * cosine(angle)) / 1000);
      vx.push(i16(i16(xc - ys) + cx));
      vy.push(i16(i16(xs + yc) + cy));
    }

    const lastX = [0, 1, 2].map((k) => ds.getInt16(m + 0x04 + k * 2, true));
    const lastY = [0, 1, 2].map((k) => ds.getInt16(m + 0x0c + k * 2, true));
    const moved = [0, 1, 2].some((k) => lastX[k] !== vx[k] || lastY[k] !== vy[k]);

    if (noErase === 0 && moved) {
      pen.setColour(ERASE_COLOUR);
      pen.moveTo(lastX[2], lastY[2]);
      for (let k = 0; k < 3; k++) pen.lineTo(lastX[k], lastY[k]);
    }
    pen.setColour(ds.getInt8(MARKER_COLOUR + i));
    pen.moveTo(vx[2], vy[2]);
    for (let k = 0; k < 3; k++) pen.lineTo(vx[k], vy[k]);

    for (let k = 0; k < 3; k++) {
      ds.setInt16(m + 0x04 + k * 2, vx[k], true);
      ds.setInt16(m + 0x0c + k * 2, vy[k], true);
    }
  }

  // 여기서부터가 천천히 새는 몫이다. 0x4D62 가 0 이면 아예 안 한다.
  const select = ds.getUint8(DECAY_SELECT);
  if (select === 0) return;

  // 네 번에 한 번쯤만 걸린다. 몫의 하위 16비트만 본다 — 원본이 `or ax, ax` 로 잰다.
  const draw = sdiv(lmul(i32(rand()), i32(Math.trunc(divisor / 20))), 32768);
  if ((draw & 0xffff) !== 0) return;

  for (let k = 1; k <= 2; k++) {
    if (select === 1 && k === 2) continue;   // 0x4D62 가 어느 쪽이 샐지를 고른다
    if (select === 2 && k === 1) continue;
    const mk = MARKER_BASE + (k << 5);
    const other = MARKER_BASE + ((3 - k) << 5);
    ds.setInt16(mk + 0x16, i16(ds.getInt16(mk + 0x16, true) - 4), true);
    ds.setUint32(other + 0x18, (ds.getUint32(other + 0x18, true) + 4) >>> 0, true);
    if (ds.getInt16(mk + 0x16, true) < 0) ds.setUint8(ROUND_OVER, 1);
  }
}
