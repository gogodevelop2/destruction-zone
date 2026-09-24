// rom/SVGA16.GDA 의 그리기를 옮긴 것이다. 800x600 16색.
//
// 왜 필요한가. 이 게임은 부딪힘을 화면에서 읽는다 — 선 탐침이 `getpixel` 로 픽셀 색을
// 묻고 그 색으로 이동을 받아들일지 정한다. 그래서 화면은 출력이 아니라 물리의 입력이고,
// 픽셀 하나가 다르면 그 프레임부터 다른 경기가 된다 (analysis/pixel_collision_design.md).
//
// 원본 드라이버 구조 (파일 0xA0 부터가 코드, 0x19F3 바이트):
//   진입 스텁이 `call word ptr [si+0x17]` 로 분산하고, si = 함수번호*2 다.
//   게임이 쓰는 것은 6 line / 9 bar / 15 setcolor / 23 getpixel / 24 putpixel 뿐이고,
//   함수 7·8·10·11·12·21 은 `ret` 하나짜리 미구현이다.
//
// ⚠ 원본은 EGA/VGA 평면 4장에 비트로 흩어 담고 VGA 쓰기모드 2 와 비트마스크를 쓴다
//   (getpixel 0x134E, putpixel 0x1386). 그 평면 조작은 **담는 방식**일 뿐이라 픽셀당
//   1바이트 배열로 같은 값이 나온다. 어느 픽셀이 칠해지는가만 그대로 옮기면 된다.
//
// ⚠ 선 무늬(line style)는 언제나 실선이다. 드라이버의 무늬 변수 초기값이 0xFFFF 이고
//   (파일 0x0A46), 무늬를 바꾸는 함수 12 가 미구현이라 게임이 바꿀 수 없다.
// @원본 없음 — rom/SVGA16.GDA 의 드라이버 함수 4·5·6. 실행 파일 안에 없다

export const WIDTH = 800;
export const HEIGHT = 600;

export class Raster {
           px            ;
           w        ;
           h        ;
  // 평면 하나가 64KiB 이고 한 행이 w/8 바이트다. 800x600 이면 화면 밖에 행 600..655 가 더 있다.
  constructor(w = WIDTH, h = HEIGHT) { this.w = w; this.h = h; this.px = new Uint8Array(Math.max(w * h, 0x10000 * 8)); }

  /**
   * 원본 함수 23. 주소는 y*(w/8) + x/8 바이트의 x%8 번째 비트다.
   * 측정 계약의 카드(svga_et4000, profile.yaml)에서 잰 것 (tools/getpixel_et4000.py): 그 주소가 첫 64KiB
   * 밖이면(음수 y, 또는 y*100 + x/8 > 0xFFFF) 원본은 카드의 뱅크를 바꿔 다른 뱅크를 읽고 0 을 낸다 —
   * 감긴 자리의 픽셀이 아니다(감긴 자리가 7 인 12곳에서 전부 0). 게임은 그 뱅크에 그린 적이 없다.
   * x 가 폭을 넘거나 음수면 오프셋이 이웃 행으로 넘어간다.
   * (전에는 svga_s3 에서 잰 tools/getpixel_bounds.py 대로 그 자리에서 멈췄다. 그 카드에서는 원본이 복귀하지
   * 않는다. 락스텝에서 robots_lowskill_30r_v1 라운드 29 가 getPixel(355,-8) 을 지나가는 것으로 드러났다.)
   */
  getPixel(x        , y        )         {
    const off = y * (this.w >> 3) + (x >> 3);
    if (off < 0 || off > 0xffff) return 0;
    return this.px[off * 8 + (x & 7)];
  }

  /** 원본 함수 24. 화면 밖에 쓸 때 원본이 무엇을 하는지는 안 쟀다 — 무시한다. */
  putPixel(x        , y        , colour        )       {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = colour & 0x0f;
  }

  /**
   * 원본 함수 6 (게임의 `line`, 호출 71곳). 코드 0x0BE9.
   *
   * 원본은 들어오자마자 **x 가 작은 쪽을 앞으로 뒤바꾼다** (0x0C09). 그래서 선을
   * 언제나 왼쪽에서 오른쪽으로 걷고, 동점 처리가 한 방향으로만 간다. 이 정규화를
   * 빼면 같은 선분인데 끝점 순서에 따라 다른 픽셀이 칠해진다.
   */
  line(x1        , y1        , x2        , y2        , colour        )       {
    if (x1 > x2) { [x1, x2] = [x2, x1]; [y1, y2] = [y2, y1]; }   // 0x0C09

    if (y1 === y2) {                                              // 0x0C36 → 가로선 전용 경로 0x0CF0
      for (let x = x1; x <= x2; x++) this.putPixel(x, y1, colour);
      return;
    }
    if (x1 === x2) {                                              // 0x0C3D → 세로선 전용 경로 0x0C41
      const lo = Math.min(y1, y2), hi = Math.max(y1, y2);         // 0x0C43 의 xchg
      for (let y = lo; y <= hi; y++) this.putPixel(x1, y, colour);
      return;
    }

    // 일반 Bresenham 0x0C74
    const dx = x2 - x1;                                           // 0x0C7A. 정규화 덕에 언제나 0 이상
    let dy = y2 - y1, ystep = 1;                                  // 0x0C7C
    if (dy < 0) { ystep = -1; dy = -dy; }                         // 0x0C7E 의 neg 둘
    const steep = dx < dy;                                        // 0x0C88 의 cmp/jge
    const major = steep ? dy : dx, minor = steep ? dx : dy;       // 0x0C8E 의 xchg
    let err = 2 * minor - major;                                  // 0x0C94..0x0C9C
    const errBoth = 2 * (minor - major);                          // [0x9a0]
    const errMajor = 2 * minor;                                   // [0x9a2]

    let x = x1, y = y1;
    for (let n = major + 1; n > 0; n--) {                         // 0x0CA7 의 inc cx
      this.putPixel(x, y, colour);
      if (err >= 0) { err += errBoth; x += 1; y += ystep; }       // 0x0CC8 의 jge → 둘 다 나아간다
      else { err += errMajor; if (steep) y += ystep; else x += 1; }
    }
  }

  /**
   * 현재점. 원본 드라이버의 `[0x19d]`/`[0x19f]` 다.
   * 함수 4(Move)가 여기에 넣고, 함수 5(Draw)가 옛 값을 꺼내 쓴 뒤 새 값을 넣는다.
   */
  cpX = 0;
  cpY = 0;

  /** 원본 함수 4. 그리지 않고 현재점만 옮긴다 (코드 0x0BD2). */
  moveTo(x        , y        )       { this.cpX = x; this.cpY = y; }

  /**
   * 원본 함수 5 (코드 0x0BDA). 옛 현재점에서 새 점까지 긋고 현재점을 옮긴다.
   * 원본은 옛 점을 cx:dx 에 담은 뒤 **함수 6 으로 그대로 떨어지므로** `line` 과 같은 코드다.
   */
  lineTo(x        , y        , colour        )       {
    this.line(this.cpX, this.cpY, x, y, colour);
    this.cpX = x; this.cpY = y;
  }

  /** 원본 함수 9 (게임의 `bar`, 호출 7곳). 채운 사각형. */
  bar(x1        , y1        , x2        , y2        , colour        )       {
    const lox = Math.min(x1, x2), hix = Math.max(x1, x2);
    const loy = Math.min(y1, y2), hiy = Math.max(y1, y2);
    for (let y = loy; y <= hiy; y++) for (let x = lox; x <= hix; x++) this.putPixel(x, y, colour);
  }
}
