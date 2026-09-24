// 날아다니는 객체를 배열에 하나 덧붙이는 0x1061C 를 옮긴 것이다.
//
// 호출 그래프의 말단이다 — 아무것도 안 부른다. 부르는 곳은 발사 `0x1077D` 와
// 물체 갱신 `0x0F3CA` 이고 자리가 24곳이다.
//
// 배열은 DGROUP `0x343C`, 보폭 32, 개수는 `0x4D71` 이다. 용량 125 는 배열 경계와
// 바이트 단위로 맞는다 — `0x343C + 125*32 = 0x43DC` 이고 한 자리 더 쓰면 `0x43FC`,
// 그것이 탱크 배열의 시작이다.
//
// ⚠ 배열을 따로 떨어진 버퍼로 두지 않는다 — DGROUP 그 자체에 얹는다. 원본은 슬롯을
//   `[bx + 0x343C + N]` 으로 경계 검사 없이 색인하고, 발사(0x1077D)의 운반체 2단계·
//   deflector·ecm wiper 가 개수(0x4D71)를 넘는 자리까지 읽는다. 4,000바이트로 자르면
//   개수가 125 미만이어도 원본은 DGROUP 의 진짜 바이트를, 포트는 빈 버퍼를 읽어 갈린다.
//   port/WORKFLOW.md "표를 잘라 쓰지 않는다" — devlog 090·096 에서 두 번 걸린 그 규칙이다.
//   그래서 세그먼트를 64KiB 통째로 두고 16비트로 접힌 오프셋으로 색인한다.
// @원본 0x1061C

export const OBJECT_BASE = 0x343c;
export const STRIDE = 32;
export const CAPACITY = 125;          // 0x10620 의 `cmp byte [0x4D71], 0x7D`
export const COUNT_OFF = 0x4d71;      // DGROUP 0x4D71 — 원본이 개수를 두는 자리

/**
 * 날아다니는 객체 배열. DGROUP(64KiB) 위에 얹혀 있다 — 슬롯은 `0x343C + i*32 + N`,
 * 개수는 `0x4D71`. 색인은 16비트로 접고 경계 검사를 하지 않는다 (원본 그대로).
 */
export class ObjectArray {
           dg            ;
                   view          ;

  constructor(dg            ) {
    this.dg = dg;
    this.view = new DataView(dg.buffer, dg.byteOffset, dg.byteLength);
  }

  /** DGROUP 0x4D71. 원본은 바이트 하나다. */
  get count()         { return this.dg[COUNT_OFF]; }
  set count(v        ) { this.dg[COUNT_OFF] = v & 0xff; }

          at(i        , off        )         { return (OBJECT_BASE + i * STRIDE + off) & 0xffff; }
  u16(i        , off        )         { return this.view.getUint16(this.at(i, off), true); }
  i16(i        , off        )         { return this.view.getInt16(this.at(i, off), true); }
  i32(i        , off        )         { return this.view.getInt32(this.at(i, off), true); }
  u8(i        , off        )         { return this.dg[this.at(i, off)]; }
  wU8(i        , off        , v        )       { this.dg[this.at(i, off)] = v & 0xff; }
  wI16(i        , off        , v        )       { this.view.setInt16(this.at(i, off), (v << 16) >> 16, true); }
  wI32(i        , off        , v        )       { this.view.setInt32(this.at(i, off), v | 0, true); }
}

const cbw = (v        )         => (v << 24) >> 24;   // 바이트를 부호 있는 값으로

/**
 * 원본 0x1061C. 인자 여덟은 전부 스택으로 온다.
 *
 * ⚠ `a`·`b`·`c` 는 워드로 넘어오지만 원본은 `mov al, byte ptr [bp+N]` + `cbw` 로
 *   **하위 바이트만 부호 확장해서** 쓴다. 100 을 넘는 값을 넘기면 잘린다.
 *
 * ⚠ `analysis/fire_and_objects.md` 가 "kind 가 0 이나 3 이면 +0x18·+0x1C·+0x1F 가 옛
 *   객체의 값을 물려받는다" 고 적어 두었는데 **틀렸다.** 셋 다 언제나 쓴다 —
 *   `cmp/jne` 의 두 갈래가 모두 저장 명령으로 모인다 (0x106F8, 0x10714, 0x1072B).
 *   2026-08-29 에 바이트를 읽고 고쳤다 (devlog 069).
 */
export function spawnObject(
  arr             ,
  owner        , x        , y        , angle        ,
  a        , b        , kind        , c        ,
)       {
  const i = arr.count & 0xff;
  if (i >= CAPACITY) return;                       // 0x10620 — 자리가 없으면 조용히 끝난다

  arr.wU8(i, 0x1e, owner & 0xff);                  // 0x10638  소유자
  arr.wI16(i, 0x12, cbw(a));                       // 0x1064C  기준 속도
  arr.wI16(i, 0x14, cbw(a));                       // 0x10660  현재 속도 — 같은 값
  arr.wI16(i, 0x16, cbw(b));                       // 0x10674  피해량
  arr.wI32(i, 0x00, x | 0);                        // 0x1068D  직전 위치 x
  arr.wI32(i, 0x04, y | 0);                        // 0x106A6  직전 위치 y
  arr.wI32(i, 0x08, x | 0);                        // 0x106BF  현재 위치 x
  arr.wI32(i, 0x0c, y | 0);                        // 0x106D8  현재 위치 y
  arr.wI16(i, 0x10, angle);                        // 0x106EA  각
  arr.wI16(i, 0x18, kind === 1 ? 1 : 0);           // 0x10706
  arr.wI16(i, 0x1c, (kind === 2 ? 1 : 0) * 1000);  // 0x10727
  arr.wU8(i, 0x1f, ((kind === 4 ? 4 : 0) + (kind === 5 ? 8 : 0)) & 0xff);  // 0x1075E
  arr.wI16(i, 0x1a, cbw(c));                       // 0x10772  유도 카운트다운

  arr.count = (arr.count + 1) & 0xff;              // 0x10776 — 다 채운 뒤에 올린다
}
