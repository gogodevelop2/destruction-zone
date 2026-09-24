// 탱크 하나를 그리거나 지우는 0x0F256 을 옮긴 것이다. 부르는 곳이 셋, 자리가 여섯이다.
//
// 부딪힘 판정이 읽는 탱크 색을 화면에 놓는 자리다. 탱크는 삼각형 하나이고, 세 꼭짓점의
// 오프셋이 레코드 안에 **부호 있는 바이트 여섯 개**로 들어 있다.
//
//   x 오프셋  +0x41, +0x42, +0x43        y 오프셋  +0x45, +0x46, +0x47
//
// `analysis/tank_movement.md` 가 이 여섯 자리를 "뜻 미확정. 위치 필드와 함께 읽히므로
// 두 번째 위치나 속도로 보인다" 로 남겨 두었는데, 그게 아니라 **각도에 따라 돌려 놓은
// 삼각형의 꼭짓점**이다 (2026-08-28 devlog 068).
//
// 지우기는 XOR 이 아니라 **같은 자리를 아레나 바닥색 8 로 다시 그리는 것**이다. 아레나
// 바닥이 단색이고 그 사이에 아무것도 덧그려지지 않았다는 전제에서만 성립한다.
// @원본 0x0F256
                                          

/** 원본이 그리기에 쓰는 탱크 레코드의 자리들. 전부 골든의 앞 감시 블록 안에 있다. */
                            
                                            
                                   
                                                        
                                                            
                                                 
                                                                  
                                                                         
 

/** 아레나 바닥색. 원본이 `mov ax, 8` 로 두 곳에 박아 두었다 (0x0F2B8, 0x0F352). */
export const FLOOR_COLOUR = 8;

const idiv = (a        , b        )         => Math.trunc(a / b);

/**
 * 원본 0x0F256.
 *
 * @param palette DGROUP `0x126F[t]` — 그 슬롯의 팔레트 자리. 지우기가 아니고 파괴되지도
 *                않았을 때 이 색으로 그린다.
 * @param erase   원본의 `[bp+8]`. 0 이 아니면 바닥색으로 그리고 세 가지를 더 지운다.
 */
export function drawTank(r        , t           , palette        , erase        )       {
  const sx = idiv(t.posX, 50);                     // 0x0F278
  const sy = idiv(t.posY, 50);                     // 0x0F299

  // 0x0F2AB — 파괴됐거나 지우는 중이면 바닥색이다
  const colour = (t.destroyed !== 0 || erase !== 0) ? FLOOR_COLOUR : palette;

  // 0x0F2CF — 마지막 꼭짓점(k=2)에서 시작해 0, 1, 2 로 이으면 삼각형이 닫힌다
  r.moveTo(sx + t.vx[2], sy + t.vy[2]);
  for (let k = 0; k <= 2; k++) r.lineTo(sx + t.vx[k], sy + t.vy[k], colour);

  if (erase === 0) return;                         // 0x0F34C

  // 지우기만 하는 셋. 그리기 쪽은 이 셋을 건드리지 않으므로 그리는 것은 다른 곳이다.
  r.line(t.strokeX1, t.strokeY1, t.strokeX2, t.strokeY2, FLOOR_COLOUR);  // 0x0F398
  r.line(sx - 1, sy, sx + 1, sy, FLOOR_COLOUR);                          // 0x0F3AA
  r.line(sx, sy - 1, sx, sy + 1, FLOOR_COLOUR);
}
